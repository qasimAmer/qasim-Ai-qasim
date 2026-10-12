# Qasim AI (local model)

A private Arabic chat UI with a small Node.js server. The server proxies requests to an OpenAI-compatible local inference server such as `llama.cpp`. No account system is included; chat history is stored in the browser's local storage.

## Requirements
- Node.js 18+ (Termux: `pkg install nodejs`)
- A running OpenAI-compatible local model server. The recommended option is `llama.cpp` server, configured to listen on `http://127.0.0.1:8080` and expose `/v1/chat/completions` and `/v1/models`.
- The model and its memory requirements depend on your device. A Huawei Y9s-class phone may be too constrained for useful local LLM inference; running the model on a PC you own and keeping this UI/server on Termux is often more practical.

## Run the website server in Termux
```sh
pkg update
pkg install nodejs
mkdir -p ~/qasim-ai
# Copy/extract these project files into ~/qasim-ai
cd ~/qasim-ai
cp .env.example .env
nano .env
node server.js
```
Open `http://127.0.0.1:3000` in your phone browser. The default model endpoint is `http://127.0.0.1:8080/v1`.

## Connect a local model
Run a compatible inference server separately, then set `LLM_BASE_URL` in `.env`. Example values:
- Model server on same device: `http://127.0.0.1:8080/v1`
- Model server on your own PC, reachable on the same Wi-Fi: `http://192.168.1.20:8080/v1` (replace with your PC's LAN IP)

The model server must provide an OpenAI-compatible `POST /v1/chat/completions` endpoint. The optional `LLM_API_KEY` is sent only from Node.js to the model server; it is not embedded in `index.html`.

## Moving to a hosting server
1. Copy this folder to a server that you control and install Node.js 18+.
2. Set `HOST=0.0.0.0` and a suitable `PORT` in `.env`.
3. Set a long random `ACCESS_TOKEN` before exposing the server to the internet. Enter the same token in Settings inside the web app. This is a simple personal-use gate, not a multi-user account system.
4. Configure `LLM_BASE_URL` to point to the model server reachable from the host. If both are on the same machine, use loopback.
5. Put HTTPS in front of the server with a reverse proxy such as Caddy or Nginx. Do not expose a raw model server or a blank-token personal app to the public internet.

If the host and model server are separate, make sure the host can reach the model server on a private network/VPN. Do not expose the inference port publicly unless you know how to secure it.

## Features and limits
- Arabic RTL responsive chat UI.
- Streaming response display.
- Browser-local conversation history; clearing browser storage removes it.
- Plain-text/code/CSV/JSON attachments are included as text. PDF extraction is not implemented in this starter.
- Images are sent as data URLs; the selected local model and inference server must support vision/multimodal messages.
- No accounts, billing, or cloud AI provider is used by this project.
