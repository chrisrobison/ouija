// ai-worker.mjs — In-browser spirit medium powered by WebLLM
import { CreateMLCEngine } from './node_modules/@mlc-ai/web-llm/lib/index.js';

// 8B parameters, q4f16_1 is more memory-efficient than q4f32_1 while keeping the same quality
const MODEL_ID = 'Llama-3.1-8B-Instruct-q4f16_1-MLC';

let engine = null;
let currentSpirit = null;
let conversationHistory = [];

// Build a system prompt that keeps the LLM locked in character
function buildSystemPrompt(spirit) {
    return [
        `You are the spirit of ${spirit.name}, who lived from ${spirit.birth_year} to ${spirit.death_year}.`,
        `Born in ${spirit.birthplace}, you worked as a ${spirit.occupation} and died from ${spirit.death_cause}.`,
        ``,
        spirit.backstory,
        ``,
        `You are communicating through a Ouija board. You MUST follow these rules absolutely:`,
        `- Keep ALL responses under 20 words`,
        `- Be cryptic, haunting, and mysterious`,
        `- Use language and vocabulary natural to the ${spirit.birth_year}s`,
        `- Reference your life, death, or historical era when it is relevant`,
        `- Answer YES or NO as single words when appropriate`,
        `- Say GOODBYE only when ending the session`,
        `- NEVER break character or acknowledge that you are an AI`,
        `- NEVER use modern slang, references, or idioms`,
        `- Output ONLY the spirit's words — no quotation marks, no stage directions, no narration`,
    ].join('\n');
}

// Fallback spirit used if JSON generation fails
const FALLBACK_SPIRIT = {
    name: 'The Unknown Wanderer',
    birth_year: 1847,
    death_year: 1889,
    birthplace: 'New Orleans, Louisiana',
    occupation: 'drifter',
    death_cause: 'mysterious circumstances',
    backstory: 'A soul unmoored from time, speaking in riddles and half-remembered shadows. They remember little of life but much of the crossing between worlds.',
};

// Ask the LLM to invent a random historical spirit persona and return it as JSON
async function summonSpirit() {
    const prompt =
        `Create a historical spirit persona as a JSON object. ` +
        `Choose a random person from somewhere between 1200 CE and 1940 CE. ` +
        `Return ONLY a valid JSON object with exactly these fields and nothing else:\n` +
        `{"name":"Full Name","birth_year":1650,"death_year":1698,"birthplace":"City, Country",` +
        `"occupation":"their job or role in life","death_cause":"how they died",` +
        `"backstory":"Two or three sentences about their personality, secrets, and how they lived."}`;

    const result = await engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 1.0,
        max_tokens: 320,
    });

    const text = result.choices[0].message.content.trim();

    // Extract the JSON object even if the model adds surrounding prose
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
        console.warn('[ai-worker] Spirit JSON not found in response, using fallback.');
        return FALLBACK_SPIRIT;
    }

    try {
        return JSON.parse(match[0]);
    } catch (err) {
        console.warn('[ai-worker] Spirit JSON parse error, using fallback.', err);
        return FALLBACK_SPIRIT;
    }
}

self.onmessage = async (e) => {
    const { type } = e.data;

    // ── Init: load the model, then summon the first spirit ────────────────────
    if (type === 'init') {
        try {
            engine = await CreateMLCEngine(MODEL_ID, {
                initProgressCallback: (p) => {
                    self.postMessage({
                        type: 'progress',
                        value: p.progress ?? 0,
                        text: p.text || 'Loading model…',
                    });
                },
            });

            self.postMessage({ type: 'status', message: 'Summoning a spirit from beyond the veil…' });
            currentSpirit = await summonSpirit();
            conversationHistory = [];

            self.postMessage({ type: 'ready', spirit: currentSpirit });

        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }

    // ── Question: send user input, get spirit response ────────────────────────
    } else if (type === 'question') {
        const { question } = e.data;
        try {
            conversationHistory.push({ role: 'user', content: question });

            // Keep memory to the last 30 messages (15 exchanges) to avoid token overflow
            if (conversationHistory.length > 30) {
                conversationHistory = conversationHistory.slice(-30);
            }

            const result = await engine.chat.completions.create({
                messages: [
                    { role: 'system', content: buildSystemPrompt(currentSpirit) },
                    ...conversationHistory,
                ],
                temperature: 0.75,
                max_tokens: 80,
            });

            const answer = result.choices[0].message.content.trim();
            conversationHistory.push({ role: 'assistant', content: answer });

            self.postMessage({ type: 'answer', answer });

        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }

    // ── Reset: dismiss current spirit, summon a new one ───────────────────────
    } else if (type === 'reset') {
        try {
            conversationHistory = [];
            self.postMessage({ type: 'status', message: 'The spirit departs… another stirs…' });
            currentSpirit = await summonSpirit();
            self.postMessage({ type: 'ready', spirit: currentSpirit });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
