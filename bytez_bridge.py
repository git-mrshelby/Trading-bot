from fastapi import FastAPI, Request
from bytez import Bytez
import uvicorn
import time

app = FastAPI()
key = "f378f34b43f48e90115663b1877ab3f9"
sdk = Bytez(key)

# This handles BOTH /v1/models and /models
@app.get("/v1/models")
@app.get("/models")
async def list_models():
    return {
        "object": "list",
        "data": [{
            "id": "anthropic/claude-opus-4-6",
            "object": "model",
            "created": int(time.time()),
            "owned_by": "bytez"
        }]
    }

# This stops the Ollama 404 errors
@app.get("/api/tags")
@app.get("/v1/api/tags")
async def ollama_fake_tags():
    return {"models": []}

@app.post("/v1/chat/completions")
@app.post("/chat/completions")
async def chat_proxy(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    
    # Run your Bytez model logic
    model = sdk.model("anthropic/claude-opus-4-6")
    results = model.run(messages)
    
    # Return OpenAI-compatible JSON
    return {
        "id": f"chatcmpl-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "anthropic/claude-opus-4-6",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": results.output},
            "finish_reason": "stop"
        }]
    }

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)