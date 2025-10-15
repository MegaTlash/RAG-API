# app/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.model import QueryRequest, QueryResponse, UploadResponse, ChatHistoryResponse
import logging
from app.utils.rag import RAG
#From app.py
import requests
import json
from sentence_transformers import CrossEncoder
import torch
import os
from dotenv import load_dotenv, find_dotenv


app = FastAPI()

# Add the CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],  # Allow your Angular app's origin
    allow_credentials=True,
    allow_methods=["*"],  # Or be more specific, e.g., ["GET", "POST"]
    allow_headers=["*"],  # Or be more specific
)


load_dotenv(find_dotenv())  # Loads .env file contents into the application based on key-value pairs defined therein, making them accessible via 'os' module functions like os.getenv().
OLLAMA_BASE_URL = os.getenv("OLLAMA_API_URL")
OLLAMA_API_URL = f"{OLLAMA_BASE_URL}/api/generate"
MODEL= "huihui_ai/qwen3-abliterated:1.7b"                                                      #Make sure you have it installed in ollama
EMBEDDINGS_MODEL = "nomic-embed-text:latest"
CROSS_ENCODER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

device = "cuda" if torch.cuda.is_available() else "cpu"
reranker = None        

# 🚀 Initialize Cross-Encoder (Reranker) at the global level 
try:
    reranker = CrossEncoder(CROSS_ENCODER_MODEL, device=device)
except Exception as e:
    logging.exception(f"Failed to load CrossEncoder model: {str(e)}")

#
messages = []
retrieval_pipeline = None
documents_loaded = False


#Parameters for RAG
rag = RAG()
rag.rag_enabled = True
rag.enable_hyde = True
rag.enable_reranking = True
rag.enable_graph_rag = True
rag.temperature = 0.2
rag.max_contexts = 4


def create_system_prompt(chat_history, context, prompt) -> str:
    # 🚀 Structured Prompt
    system_prompt = f"""Use the chat history to maintain context:
        Chat History:
        {chat_history}

        Analyze the question and context through these steps:
        1. Identify key entities and relationships
        2. Check for contradictions between sources
        3. Synthesize information from multiple contexts
        4. Formulate a structured response

        Context:
        {context}

        Question: {prompt}
        Answer:"""
    return system_prompt



def get_response_ollama(prompt: str, 
                        model: str = MODEL, 
                        stream: bool = True, 
                        temperature: float = rag.temperature,
                        num_ctx: int = 4096) -> str:
    response = requests.post(
            OLLAMA_API_URL,
            json={
                "model": model,
                "prompt": prompt,
                "stream": stream,
                "options": {
                    "temperature":temperature,  # Use dynamic user-selected value
                    "num_ctx": num_ctx
                }
            },
            stream=True
        )
    return response

#!REMOVE BECAUSE USER IS NOT SUPPOSE TO UPLOAD DOCUMENTS
@app.post("/upload", response_model=UploadResponse)
async def upload_documents(files: list[UploadFile] = File(...)):
    """
    Endpoint to upload and process documents.
    Accepts PDF, DOCX, and TXT files.
    """
    valid_ext = ["pdf", "docx", "txt"]
    valid_files = [file for file in files if file.filename.split('.')[-1].lower() in valid_ext]
    
    if all(valid_files) != True:
        raise HTTPException(status_code=400, detail="Not all files were valid (pdf, docx, txt) were uploaded.")
    await rag.process_documents(valid_files, reranker, EMBEDDINGS_MODEL, OLLAMA_BASE_URL)
    
    return UploadResponse(status="success", message=f"Successfully processed {len(valid_files)} documents.")

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    """
    Endpoint to query the DeepSeek-RAG model.
    """
    chat_history = "\n".join([msg["content"] for msg in rag.messages[-5:]]) 
    rag.append_message({"role": "user", "content": request.query})
    
    
    full_response = ""
    context = ""
    
    if rag.rag_enabled and rag.retrieval_pipeline:
        try:
            docs = rag.retrieve_documents(request.query, OLLAMA_API_URL, MODEL, chat_history)
            context = "\n".join(
                f"[Source {i+1}]: {doc.page_content}" 
                for i, doc in enumerate(docs)
            )
        except Exception as e:
            logging.exception(f"Retrieval error: {str(e)}")
            context = "Error: Could not retrieve documents."

    system_prompt = create_system_prompt(chat_history, context, request.query)
    response = get_response_ollama(system_prompt)
    try:
        for line in response.iter_lines():
            if line:
                data = json.loads(line.decode())
                token = data.get("response", "")
                full_response += token
                
                # Stop if we detect the end token
                if data.get("done", False):
                    break
                    
        rag.append_message({"role": "assistant", "content": full_response})
        
    except Exception as e:
        logging.exception(f"Generation error: {str(e)}")
        full_response = "Sorry, I encountered an error during generation."
        rag.append_message({"role": "assistant", "content": full_response})
        
    return QueryResponse(result=full_response)

@app.get("/chat_messages", response_model=ChatHistoryResponse)
async def get_chat_messages():
    return ChatHistoryResponse(messages=rag.messages)