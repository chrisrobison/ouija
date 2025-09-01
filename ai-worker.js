importScripts('https://unpkg.com/@mlc-ai/web-llm@0.2.79/lib/index.js');

let engine;

// Respond to messages from the main thread.
self.onmessage = async (event) => {
    const data = event.data;
    if (data.type === 'init') {
        // Load the model inside the worker so UI remains responsive.
        engine = await webllm.createMLCEngine('Llama-3.1-8B-Instruct-q4f32_1-MLC');
        self.postMessage({ type: 'ready' });
    } else if (data.type === 'question') {
        if (!engine) {
            self.postMessage({ type: 'error', error: 'Engine not initialized' });
            return;
        }
        try {
            // Generate a response from the local model.
            const result = await engine.chat.completions.create({
                messages: [{ role: 'user', content: data.question }]
            });
            const text = result.choices[0].message.content;
            self.postMessage({ type: 'answer', answer: text });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
