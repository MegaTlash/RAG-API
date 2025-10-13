from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain.text_splitter import CharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_community.retrievers import BM25Retriever
from langchain.retrievers import EnsembleRetriever
from langchain_core.documents import Document

from rank_bm25 import BM25Okapi
import os
import networkx as nx
import re
import requests

import logging

class RAG:
    def __init__(self) -> None:
        self.documents_loaded = False
        self.processing = False
        
        self.messages = []
        self.retrieval_pipeline = None
        self.documents_loaded = False

        #Parameters for RAG
        self.rag_enabled = True
        self.enable_hyde = True
        self.enable_reranking = True
        self.enable_graph_rag = True
        self.temperature = 0.2
        self.max_contexts = 4
        
        
    @property
    def rag_enabled(self):
        return self._rag_enabled
    
    @rag_enabled.setter
    def rag_enabled(self, value):
        self._rag_enabled = value
        
    @property
    def retrieval_pipeline(self):
        return self._retrieval_pipeline
    
    @retrieval_pipeline.setter
    def retrieval_pipeline(self, value):
        self._retrieval_pipeline = value
        
    @property
    def messages(self):
        return self._messages
    
    @messages.setter
    def messages(self, value):  
        self._messages = value
    
    def append_message(self, value_to_append):
        self.messages.append(value_to_append)
    
    @property
    def enable_hyde(self):
        return self._enable_hyde
    
    @enable_hyde.setter
    def enable_hyde(self, value):
        self._enable_hyde = value

    @property
    def enable_reranking(self):
        return self._enable_reranking  
    
    @enable_reranking.setter
    def enable_reranking(self, value):
        self._enable_reranking = value
        
    @property
    def enable_graph_rag(self):
        return self._enable_graph_rag
    
    @enable_graph_rag.setter
    def enable_graph_rag(self, value):
        self._enable_graph_rag = value
    
    @property
    def temperature(self):
        return self._temperature
    
    @temperature.setter
    def temperature(self, value):
        self._temperature = value
    
    @property
    def max_contexts(self):
        return self._max_contexts
    
    @max_contexts.setter
    def max_contexts(self, value):
        self._max_contexts = value

    def build_knowledge_graph(self, docs):
        G = nx.Graph()
        for doc in docs:
            entities = re.findall(r'\b[A-Z][a-z]+(?: [A-Z][a-z]+)*\b', doc.page_content)
            # Ensure meaningful relationships exist
            if len(entities) > 1:
                for i in range(len(entities) - 1):
                    G.add_edge(entities[i], entities[i + 1])  # Create edge
        return G
    
    def retrieve_from_graph(self, query, G, top_k=5):
        # Convert query into words to match knowledge graph nodes
        query_words = query.lower().split()
        matched_nodes = [node for node in G.nodes if any(word in node.lower() for word in query_words)]
        
        if matched_nodes:
            related_nodes = []
            for node in matched_nodes:
                related_nodes.extend(list(G.neighbors(node)))  # Get connected nodes
            
            return related_nodes[:top_k]
        
        return []
    
    async def process_documents(self, uploaded_files,reranker,embedding_model, base_url):
        if self.documents_loaded:
            return

        self.processing = True
        documents = []
        
        # Create temp directory
        if not os.path.exists("temp"):
            os.makedirs("temp")
        
        # Process files
        for file in uploaded_files:
            try:
                file_path = os.path.join("temp", file.filename)
                with open(file_path, "wb") as f:
                    contents = await file.read()
                    f.write(contents)

                if file.filename.endswith(".pdf"):
                    loader = PyPDFLoader(file_path)
                elif file.filename.endswith(".docx"):
                    loader = Docx2txtLoader(file_path)
                elif file.filename.endswith(".txt"):
                    loader = TextLoader(file_path)
                else:
                    continue
                    
                documents.extend(loader.load())
                os.remove(file_path)
            except Exception as e:
                logging.error(f"Error processing {file.filename}: {str(e)}")
                return

        # Text splitting
        text_splitter = CharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            separator="\n"
        )
        texts = text_splitter.split_documents(documents)
        text_contents = [doc.page_content for doc in texts]

        # 🚀 Hybrid Retrieval Setup
        embeddings = OllamaEmbeddings(model=embedding_model, base_url=base_url)
        
        # Vector store
        vector_store = FAISS.from_documents(texts, embeddings)
        
        # BM25 store
        bm25_retriever = BM25Retriever.from_texts(
            text_contents, 
            bm25_impl=BM25Okapi,
            preprocess_func=lambda text: re.sub(r"\W+", " ", text).lower().split()
        )

        # Ensemble retrieval
        ensemble_retriever = EnsembleRetriever(
            retrievers=[
                bm25_retriever,
                vector_store.as_retriever(search_kwargs={"k": 5})
            ],
            weights=[0.4, 0.6]
        )

        # Store in session
        self.retrieval_pipeline = {
            "ensemble": ensemble_retriever,
            "reranker": reranker,  # Now using the global reranker variable
            "texts": text_contents,
            "knowledge_graph": self.build_knowledge_graph(texts)  # Store Knowledge Graph
        }

        self.documents_loaded = True
        self.processing = False

    def expand_query(self, query,uri,model):
        try:
            response = requests.post(uri, json={
                "model": model,
                "prompt": f"Generate a hypothetical answer to: {query}",
                "stream": False
            }).json()
            return f"{query}\n{response.get('response', '')}"
        except Exception as e:
            logging.error(f"Query expansion failed: {str(e)}")
            return query
    
    # 🚀 Advanced Retrieval Pipeline
    def retrieve_documents(self, query, uri, model, chat_history=""):
        expanded_query = self.expand_query(f"{chat_history}\n{query}", uri, model) if self.enable_hyde else query
        
        # 🔍 Retrieve documents using BM25 + FAISS
        docs = self.retrieval_pipeline["ensemble"].invoke(expanded_query)

        # 🚀 GraphRAG Retrieval
        if self.enable_graph_rag:
            graph_results = self.retrieve_from_graph(query, self.retrieval_pipeline["knowledge_graph"])
            
            # Debugging output
            logging.info(f"🔍 GraphRAG Retrieved Nodes: {graph_results}")

            # Ensure graph results are correctly formatted
            graph_docs = []
            for node in graph_results:
                graph_docs.append(Document(page_content=node))  # ✅ Fix: Correct Document initialization

            # If graph retrieval is successful, merge it with standard document retrieval
            if graph_docs:
                docs = graph_docs + docs  # Merge GraphRAG results with FAISS + BM25 results
        
        # 🚀 Neural Reranking (if enabled)
        if self.enable_reranking:
            pairs = [[query, doc.page_content] for doc in docs]  # ✅ Fix: Use `page_content`
            scores = self.retrieval_pipeline["reranker"].predict(pairs)

            # Sort documents based on reranking scores
            ranked_docs = [doc for _, doc in sorted(zip(scores, docs), reverse=True)]
        else:
            ranked_docs = docs

        return ranked_docs[:self.max_contexts]  # Return top results based on max_contexts

    
    