<div align="center">
  <img src="https://img.icons8.com/?size=100&id=D0W12kI7fU57&format=png&color=000000" width="80" alt="logo"/>
  <h1>🌺 MAVELI.AI 🌺</h1>
  <p><strong>A Next-Gen Adaptive Physical-AI Onam VR Experience</strong></p>

  <p>
    <a href="#features">Features</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#setup">Setup & Installation</a> •
    <a href="#gameplay-loop">Gameplay Loop</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Python-3.13-blue?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
    <img src="https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi" alt="FastAPI" />
    <img src="https://img.shields.io/badge/Arduino-00979D?style=for-the-badge&logo=Arduino&logoColor=white" alt="Arduino" />
    <img src="https://img.shields.io/badge/WebXR-333333?style=for-the-badge&logo=meta&logoColor=white" alt="WebXR" />
    <img src="https://img.shields.io/badge/Gemma-AI-FF6F00?style=for-the-badge&logo=google&logoColor=white" alt="Gemma AI" />
  </p>
</div>

---

## 🌟 Overview

**MAVELI.AI** bridges the gap between traditional board games, immersive Virtual Reality (WebXR), and cutting-edge adaptive AI. Play a physically engineered Snake & Ladder board game where landing on specific zones dynamically drops you into an Onam-themed VR challenge on the Meta Quest 3! 

Powered by **Gemma** (via Ollama), the game continuously tracks player performance to adapt difficulty on the fly, creating a responsive physical-AI loop where virtual success directly controls physical servos and LEDs on the board.

---

## ✨ Features

- 🎮 **Physical-AI Integration:** Real-world button presses and hardware interact directly with VR environments and LLM decision-making.
- 🧠 **Adaptive Difficulty Engine:** Uses Google's Gemma to analyze player statistics (response times, success rates) and auto-tune the difficulty of VR challenges in real time.
- 🥽 **Immersive WebXR Games:** Play dynamic mini-games directly in the browser:
  - [Uri-Adi](https://uri-adi.vercel.app/)
  - [Vallamkali](https://vallamkali.vercel.app/)
  - [Sadya Memory](https://level-2-memory.vercel.app/)
  - [Chenda Master](https://chenda.vercel.app/)
- 🧩 **Trivia Engine:** Lands on a Trivia cell? The backend parses a rich markdown-based trivia pool and quizzes you on Onam facts!
- 🖥️ **Premium Dashboard:** A beautiful, responsive glassmorphism dashboard that acts as the referee screen and VR game launcher.
- 🤖 **Servo & LED Matrix Control:** Sends direct commands to an Arduino to move a Mahabali servo and highlight zones on an 18x20 LED board.

---

## 🏗️ Architecture

```mermaid
graph TD
    A[Physical Board & Arduino] <-->|USB Serial| B(Python Game Engine)
    B -->|Player Stats| C{Gemma AI}
    C -->|Difficulty & Game Choice| B
    B <-->|WebSocket| D[Premium Web Dashboard]
    D -->|Iframe/Launcher| E[VR WebXR Games]
    E -->|REST POST /vr/result| B
```

- **`game_engine.py`**: The referee. Manages state, RNG, positions, and triggers VR/Trivia challenges.
- **`gemma_adaptive.py`**: The brain. Evaluates player stats and instructs the engine on difficulty & game type.
- **`serial_handler.py`**: The bridge. Reads physical button presses and drives servos/LEDs.
- **`trivia_parser.py`**: The quizmaster. Parses `questions.md` dynamically into game challenges.
- **`main.py`**: The server. Serves static files, hosts the dashboard, and manages WebSocket connections.

---



## 🔄 The Gameplay Loop

> Player rolls physically → Arduino reports the button press → Game Engine moves the piece and drives the wheel servo → If landed on a snake, ladder, or trivia zone, the engine asks **Gemma** to size the next VR challenge to that specific player's recent performance → The VR dashboard launches the mini-game → The VR result comes back → Game Engine updates the board *and* physically moves the Mahabali servo based on player success. 

<div align="center">
  <p><i>That last step — an AI decision changing a physical object in the real world — is the Physical-AI story.</i></p>
</div>

---

## 📸 Image Documentation

<div align="center">
  <img src="image%20documentation/dev.jpeg" width="400" alt="Overview" />
  <img src="image%20documentation/vl.jpeg" width="400" alt="Vallamkali" />
  <img src="image%20documentation/ur.jpeg" width="400" alt="Uri-Adi" />
  <img src="image%20documentation/sl.jpeg" width="400" alt="Snake & Ladder" />
</div>
