# Claudian optimizations + voice

A companion plugin for [Claudian](https://github.com/YishenTu/claudian) that modernizes the UI and adds a few workflow tweaks. It sits on top of Claudian and does not modify it. If Claudian changes its internals, the patches fall back silently to Claudian's own behavior.

**Showcase, not maintained.** Shared to show the ideas. Built and tested on Claudian 2.3.30, Obsidian on macOS.

## What it does
- Real tabs: full conversation title instead of a number, status in the tab, × on hover to close, middle-click closes, + right after the last tab
- Right-click no longer closes a tab
- Cleaner look: white message bubble and input, larger input text, neutral toolbar with soft hover states
- Effort picker opens on click instead of hover
- Pasted images show a thumbnail in the chip
- Linked-note chip is clickable: pick a different note via the @-menu, or unlink with × at any time
- `/rename <title>` renames the conversation from the input
- Mic button for dictation: tap to start/stop, hold to talk, ⌘D to toggle, Esc to cancel. Transcribed locally with whisper.cpp, text lands at the cursor in the composer

## Install
```bash
cd <your-vault>/.obsidian/plugins
git clone https://github.com/DvT093/claudian-optimizations.git
```
Reload Obsidian and enable **Claudian optimizations + voice** under Community plugins.

## Voice (optional, macOS)
Everything except the mic works without this.
```bash
brew install whisper-cpp ffmpeg
mkdir -p ~/.local/share/whisper
curl -L -o ~/.local/share/whisper/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```
Dictation language is set to Dutch (`-l nl` in `main.js`), change it to yours. `WHISPER_PROMPT` holds a short vocabulary hint for terms Whisper tends to misspell. The first transcription takes a while to warm up, after that about 2 s per sentence on an M2 Pro.

Code comments are in Dutch.
