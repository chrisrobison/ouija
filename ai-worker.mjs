// ai-worker.mjs
import { CreateMLCEngine } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/lib/index.js';
let engine;
self.onmessage = async (e) => {
  const { type, question } = e.data;
  if (type === 'init') {
    engine = await CreateMLCEngine('Llama-3.1-8B-Instruct-q4f32_1-MLC');
    self.postMessage({ type: 'ready' });
  } else if (type === 'question') {
    const r = await engine.chat.completions.create({ messages: [{ role: 'user', content: question }] });
    self.postMessage({ type: 'answer', answer: r.choices[0].message.content });
  }
};
