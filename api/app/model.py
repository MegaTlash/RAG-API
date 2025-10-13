from pydantic import BaseModel
from typing import List

class QueryRequest(BaseModel):
    query: str

class QueryResponse(BaseModel):
    result: str
    
class UploadResponse(BaseModel):
    status: str
    message: str

class Message(BaseModel):
    role: str
    content: str

class ChatHistoryResponse(BaseModel):
    messages: List[Message]