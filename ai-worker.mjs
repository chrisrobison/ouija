// ai-worker.mjs — In-browser spirit medium powered by WebLLM
import { CreateMLCEngine } from './node_modules/@mlc-ai/web-llm/lib/index.js';
import * as storage from './worker-storage.mjs';

// 8B parameters, q4f16_1 is more memory-efficient than q4f32_1 while keeping the same quality
const MODEL_ID = 'Llama-3.1-8B-Instruct-q4f16_1-MLC';

let engine = null;
let currentSpirit = null;
let conversationHistory = [];

function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `spirit_${Date.now()}`;
}

function normalizeSpirit(spirit) {
    const base = { ...spirit };
    if (!base._id) {
        const slugSource = `${base.name || 'spirit'}_${base.birth_year || ''}_${base.birthplace || ''}`;
        base._id = slugify(slugSource);
    }
    return base;
}

async function persistSpiritState(spirit, history) {
    if (!spirit?._id) return;
    const record = {
        _id: spirit._id,
        spirit,
        conversation: history,
    };
    try {
        await storage.saveSpiritRecord(record);
        await storage.setCurrentSpiritId(spirit._id);
    } catch (err) {
        console.warn('[ai-worker] Failed to persist spirit state:', err);
    }
}

async function restoreSpiritState() {
    try {
        const record = await storage.loadCurrentState();
        if (record?.spirit) {
            currentSpirit = record.spirit;
            conversationHistory = Array.isArray(record.conversation) ? record.conversation : [];
            return true;
        }
    } catch (err) {
        console.warn('[ai-worker] Unable to restore previous spirit:', err);
    }
    return false;
}

function trimConversation() {
    if (conversationHistory.length > 30) {
        conversationHistory = conversationHistory.slice(-30);
    }
}

async function saveConversationSnapshot() {
    try {
        await storage.updateConversation(currentSpirit?._id, conversationHistory);
    } catch (err) {
        console.warn('[ai-worker] Failed to persist conversation history:', err);
    }
}

function respondToRequest(requestId, payload) {
    if (typeof requestId === 'undefined') return;
    self.postMessage({ ...payload, replyTo: requestId });
}

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
        return normalizeSpirit(FALLBACK_SPIRIT);
    }

    try {
        return normalizeSpirit(JSON.parse(match[0]));
    } catch (err) {
        console.warn('[ai-worker] Spirit JSON parse error, using fallback.', err);
        return normalizeSpirit(FALLBACK_SPIRIT);
    }
}

self.onmessage = async (e) => {
    const { type, requestId } = e.data;

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

            const restored = await restoreSpiritState();
            if (!restored) {
                self.postMessage({ type: 'status', message: 'Summoning a spirit from beyond the veil…' });
                currentSpirit = await summonSpirit();
                conversationHistory = [];
                await persistSpiritState(currentSpirit, conversationHistory);
            } else {
                self.postMessage({ type: 'status', message: 'Rejoined your previous session.' });
            }

            self.postMessage({ type: 'ready', spirit: currentSpirit, restored });

        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }

    // ── Question: send user input, get spirit response ────────────────────────
    } else if (type === 'question') {
        const { question } = e.data;
        try {
            conversationHistory.push({ role: 'user', content: question });

            trimConversation();

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
            trimConversation();
            await saveConversationSnapshot();

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
            await persistSpiritState(currentSpirit, conversationHistory);
            self.postMessage({ type: 'ready', spirit: currentSpirit });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    } else if (type === 'list-spirits') {
        try {
            const records = await storage.listSpirits();
            const spirits = records.map((rec) => ({
                _id: rec._id,
                spirit: rec.spirit,
                conversationLength: rec.conversation?.length || 0,
            }));
            respondToRequest(requestId, { type: 'list-spirits-result', spirits });
        } catch (err) {
            respondToRequest(requestId, { type: 'list-spirits-result', error: err.message });
        }
    } else if (type === 'switch-spirit') {
        const { spiritId } = e.data;
        try {
            const record = await storage.loadSpiritRecord(spiritId);
            if (!record) {
                respondToRequest(requestId, { type: 'switch-spirit-result', error: 'Spirit not found.' });
                return;
            }
            currentSpirit = record.spirit;
            conversationHistory = Array.isArray(record.conversation) ? record.conversation : [];
            await storage.setCurrentSpiritId(currentSpirit._id);
            respondToRequest(requestId, { type: 'switch-spirit-result', spirit: currentSpirit });
            self.postMessage({ type: 'ready', spirit: currentSpirit, restored: true, source: 'switch' });
        } catch (err) {
            respondToRequest(requestId, { type: 'switch-spirit-result', error: err.message });
        }
    } else if (type === 'spirit-history') {
        const { spiritId } = e.data;
        try {
            const targetId = spiritId || currentSpirit?._id;
            const record = await storage.loadSpiritRecord(targetId);
            const history = record?.conversation || [];
            respondToRequest(requestId, { type: 'spirit-history-result', history });
        } catch (err) {
            respondToRequest(requestId, { type: 'spirit-history-result', error: err.message });
        }
    } else if (type === 'spirit-profile') {
        const { spiritId } = e.data;
        try {
            const targetId = spiritId || currentSpirit?._id;
            const record = await storage.loadSpiritRecord(targetId);
            if (!record) {
                respondToRequest(requestId, { type: 'spirit-profile-result', error: 'Spirit not found.' });
                return;
            }
            respondToRequest(requestId, { type: 'spirit-profile-result', spirit: record.spirit });
        } catch (err) {
            respondToRequest(requestId, { type: 'spirit-profile-result', error: err.message });
        }
    }
};
