#!/bin/bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-7630ee9950b940aa87c012c5352ef4c5" \
  -d '{
        "model": "deepseek-chat",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Are you ok? You seem a bit slow today."}
        ],
        "stream": false
      }'
