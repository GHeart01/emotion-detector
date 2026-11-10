---
title: Emotion Detector
emoji: 😊
colorFrom: yellow
colorTo: red
sdk: static
app_file: index.html
pinned: false
short_description: Detect 28 emotions in text, right in your browser
models:
  - Horizon-Labs/multilingual-emotions-small
---

# Emotion Detector

A static demo that finds the emotions in a piece of text (28 GoEmotions labels,
40+ languages) using
[Horizon-Labs/multilingual-emotions-small](https://huggingface.co/Horizon-Labs/multilingual-emotions-small)
and [Transformers.js](https://huggingface.co/docs/transformers.js).

The model runs entirely in the visitor's browser. Nothing is sent to a server.

The model is about 270 MB and downloads automatically when the page opens. By
default nothing is stored on the visitor's device: the model lives only in the
tab's memory and is gone when the tab closes. Visitors can tick a box to keep it
on their device for faster later visits, and remove it again with one click.
