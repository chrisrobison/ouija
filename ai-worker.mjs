// ai-worker.mjs — In-browser spirit medium powered by WebLLM or OpenAI-compatible endpoints
import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';
import * as storage from './worker-storage.mjs';

const SETTINGS_KEY = 'runtimeSettings';
const DEFAULT_WEBLLM_MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';

const WEBLLM_MODEL_PRESETS = [
    { id: 'Qwen3.5-0.8B-q4f16_1-MLC', label: 'Qwen3.5 0.8B (local)', approxParams: '0.8B' },
    { id: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen3.5 2B (local)', approxParams: '2B' },
    { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B (local)', approxParams: '4B' },
    { id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', label: 'DeepSeek-R1 Distill Qwen 7B (local)', approxParams: '7B' },
    { id: 'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC', label: 'DeepSeek-R1 Distill Llama 8B (local)', approxParams: '8B' },
    { id: 'Qwen3-8B-q4f16_1-MLC', label: 'Qwen3 8B (local)', approxParams: '8B' },
    { id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', label: 'Llama 3.1 8B Instruct (local)', approxParams: '8B' },
];

const ENDPOINT_DISTILLED_PRESETS = [
    {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
        label: 'DeepSeek-R1 Distill Qwen 1.5B',
        approxParams: '1.5B',
    },
    {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        label: 'DeepSeek-R1 Distill Qwen 7B',
        approxParams: '7B',
    },
    {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
        label: 'DeepSeek-R1 Distill Qwen 14B',
        approxParams: '14B',
    },
    {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
        label: 'DeepSeek-R1 Distill Qwen 32B (30B-class)',
        approxParams: '32B',
    },
    {
        id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
        label: 'DeepSeek-R1 Distill Llama 8B',
        approxParams: '8B',
    },
];

const DEFAULT_SETTINGS = {
    provider: 'webllm',
    webllmModel: DEFAULT_WEBLLM_MODEL,
    openai: {
        baseUrl: '',
        apiKey: '',
        model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    },
};

let engine = null;
let currentSpirit = null;
let conversationHistory = [];

let runtimeSettings = null;
let hasPersistedSettings = false;
let activeBackend = null;
let loadedWebllmModel = null;

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

function cloneSettings(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeSettings(input = {}) {
    const merged = {
        ...DEFAULT_SETTINGS,
        ...(input || {}),
        openai: {
            ...DEFAULT_SETTINGS.openai,
            ...((input || {}).openai || {}),
        },
    };

    const provider = merged.provider === 'openai-compatible' ? 'openai-compatible' : 'webllm';
    const webllmModel = (merged.webllmModel || DEFAULT_WEBLLM_MODEL).trim();

    return {
        provider,
        webllmModel,
        openai: {
            baseUrl: String(merged.openai.baseUrl || '').trim(),
            apiKey: String(merged.openai.apiKey || '').trim(),
            model: String(merged.openai.model || '').trim(),
        },
    };
}

async function ensureRuntimeSettingsLoaded() {
    if (runtimeSettings) {
        return;
    }
    const saved = await storage.getMeta(SETTINGS_KEY);
    if (saved && typeof saved === 'object') {
        runtimeSettings = normalizeSettings(saved);
        hasPersistedSettings = true;
    } else {
        runtimeSettings = cloneSettings(DEFAULT_SETTINGS);
        hasPersistedSettings = false;
    }
}

async function persistRuntimeSettings() {
    await storage.setMeta(SETTINGS_KEY, runtimeSettings);
    hasPersistedSettings = true;
}

function getRuntimeInfo() {
    if (!runtimeSettings) {
        return {
            provider: 'webllm',
            model: DEFAULT_WEBLLM_MODEL,
        };
    }

    if (runtimeSettings.provider === 'openai-compatible') {
        return {
            provider: 'openai-compatible',
            model: runtimeSettings.openai.model,
            baseUrl: runtimeSettings.openai.baseUrl,
        };
    }

    return {
        provider: 'webllm',
        model: runtimeSettings.webllmModel,
    };
}

function getSettingsPayload() {
    return {
        settings: cloneSettings(runtimeSettings || DEFAULT_SETTINGS),
        firstRun: !hasPersistedSettings,
        runtime: getRuntimeInfo(),
        webllmModels: WEBLLM_MODEL_PRESETS,
        endpointDistilledModels: ENDPOINT_DISTILLED_PRESETS,
    };
}

async function unloadEngineIfNeeded() {
    if (!engine) {
        return;
    }
    if (typeof engine.unload === 'function') {
        await engine.unload();
    }
    engine = null;
    loadedWebllmModel = null;
}

function emitProgress(value, text) {
    self.postMessage({ type: 'progress', value, text });
}

function emitStatus(message) {
    self.postMessage({ type: 'status', message });
}

async function loadBackend({ force = false } = {}) {
    await ensureRuntimeSettingsLoaded();

    if (runtimeSettings.provider === 'webllm') {
        const targetModel = runtimeSettings.webllmModel || DEFAULT_WEBLLM_MODEL;
        if (!force && activeBackend === 'webllm' && loadedWebllmModel === targetModel && engine) {
            return;
        }

        await unloadEngineIfNeeded();
        emitStatus(`Loading ${targetModel}…`);
        engine = await CreateMLCEngine(targetModel, {
            initProgressCallback: (p) => {
                emitProgress(p.progress ?? 0, p.text || `Loading ${targetModel}…`);
            },
        });
        activeBackend = 'webllm';
        loadedWebllmModel = targetModel;
        emitProgress(1, `${targetModel} ready.`);
        return;
    }

    const { baseUrl, model } = runtimeSettings.openai;
    if (!baseUrl) {
        throw new Error('OpenAI-compatible mode requires a base URL.');
    }
    if (!model) {
        throw new Error('OpenAI-compatible mode requires a model name.');
    }

    if (!force && activeBackend === 'openai-compatible') {
        return;
    }

    await unloadEngineIfNeeded();
    activeBackend = 'openai-compatible';
    emitProgress(1, 'Endpoint mode ready.');
}

function buildChatCompletionUrl(baseUrl) {
    const clean = String(baseUrl || '').trim().replace(/\/$/, '');
    if (!clean) return '';
    if (clean.endsWith('/chat/completions')) return clean;
    if (clean.endsWith('/v1')) return `${clean}/chat/completions`;
    return `${clean}/v1/chat/completions`;
}

async function createCompletion(messages, { temperature = 0.6, max_tokens = 80 } = {}) {
    await ensureRuntimeSettingsLoaded();

    if (runtimeSettings.provider === 'openai-compatible') {
        const endpointUrl = buildChatCompletionUrl(runtimeSettings.openai.baseUrl);
        if (!endpointUrl) {
            throw new Error('OpenAI-compatible endpoint URL is missing.');
        }

        const headers = {
            'Content-Type': 'application/json',
        };
        if (runtimeSettings.openai.apiKey) {
            headers.Authorization = `Bearer ${runtimeSettings.openai.apiKey}`;
        }

        const response = await fetch(endpointUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: runtimeSettings.openai.model,
                messages,
                temperature,
                max_tokens,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Endpoint returned ${response.status}: ${text.slice(0, 220)}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new Error('Endpoint response did not include choices[0].message.content.');
        }
        return content.trim();
    }

    if (!engine) {
        await loadBackend();
    }

    const result = await engine.chat.completions.create({
        messages,
        temperature,
        max_tokens,
    });

    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Model returned an empty response.');
    }
    return content.trim();
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

function isLikelyYesNoQuestion(question) {
    const lower = String(question || '').trim().toLowerCase();
    if (!lower) return false;
    return /^(is|are|am|was|were|do|does|did|can|could|should|would|will|has|have|had|may|might)\b/.test(lower);
}

function normalizeOuijaAnswer(question, rawAnswer) {
    const upper = String(rawAnswer || '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!upper) {
        return 'SILENCE';
    }

    const tokens = upper.split(' ');

    if (isLikelyYesNoQuestion(question)) {
        if (tokens.includes('NO') || tokens.includes('NOT') || tokens.includes('NEVER')) {
            return 'NO';
        }
        if (tokens.includes('YES')) {
            return 'YES';
        }
        return /^N/.test(tokens[0]) ? 'NO' : 'YES';
    }

    if (tokens[0] === 'YES' || tokens[0] === 'NO' || tokens[0] === 'GOODBYE') {
        return tokens[0];
    }

    return tokens.slice(0, 4).join(' ');
}

// Build a system prompt that keeps the LLM locked in character and very terse.
function buildSystemPrompt(spirit) {
    return [
        `You are the spirit of ${spirit.name}, who lived from ${spirit.birth_year} to ${spirit.death_year}.`,
        `Born in ${spirit.birthplace}, you worked as a ${spirit.occupation} and died from ${spirit.death_cause}.`,
        '',
        spirit.backstory,
        '',
        'You are communicating through a Ouija board. You MUST follow these rules absolutely:',
        '- Respond with 1 to 4 words only',
        '- Never output complete grammatical sentences',
        '- If the question is yes/no, answer with exactly YES or NO',
        '- Be cryptic, eerie, and sparse',
        '- Prefer fragments, names, dates, places, omens',
        '- Say GOODBYE only when ending the session',
        '- NEVER break character or mention AI',
        '- Output only the spirit text with no narration and no quotes',
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
    backstory: 'A soul unmoored from time, speaking in riddles and half-remembered shadows.',
};

// Ask the model to invent a random historical spirit persona and return it as JSON.
async function summonSpirit() {
    const prompt =
        'Create a historical spirit persona as a JSON object. ' +
        'Choose a random person from somewhere between 1200 CE and 1940 CE. ' +
        'Return ONLY a valid JSON object with exactly these fields and nothing else:\n' +
        '{"name":"Full Name","birth_year":1650,"death_year":1698,"birthplace":"City, Country",' +
        '"occupation":"their job or role in life","death_cause":"how they died",' +
        '"backstory":"Two or three sentences about their personality, secrets, and how they lived."}';

    const text = await createCompletion([{ role: 'user', content: prompt }], {
        temperature: 0.95,
        max_tokens: 320,
    });

    // Extract the JSON object even if the model adds surrounding prose.
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

    // Init: load provider+model, then summon/restore a spirit.
    if (type === 'init') {
        try {
            await loadBackend();

            const restored = await restoreSpiritState();
            if (!restored) {
                emitStatus('Summoning a spirit from beyond the veil…');
                currentSpirit = await summonSpirit();
                conversationHistory = [];
                await persistSpiritState(currentSpirit, conversationHistory);
            } else {
                emitStatus('Rejoined your previous session.');
            }

            self.postMessage({
                type: 'ready',
                spirit: currentSpirit,
                restored,
                runtime: getRuntimeInfo(),
            });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }

    // Question: send user input, get spirit response.
    } else if (type === 'question') {
        const { question } = e.data;
        try {
            conversationHistory.push({ role: 'user', content: question });
            trimConversation();

            const rawAnswer = await createCompletion(
                [
                    { role: 'system', content: buildSystemPrompt(currentSpirit) },
                    ...conversationHistory,
                ],
                { temperature: 0.5, max_tokens: 24 }
            );

            const answer = normalizeOuijaAnswer(question, rawAnswer);
            conversationHistory.push({ role: 'assistant', content: answer });
            trimConversation();
            await saveConversationSnapshot();

            self.postMessage({ type: 'answer', answer });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }

    // Reset: dismiss current spirit, summon a new one.
    } else if (type === 'reset') {
        try {
            conversationHistory = [];
            emitStatus('The spirit departs… another stirs…');
            currentSpirit = await summonSpirit();
            await persistSpiritState(currentSpirit, conversationHistory);
            self.postMessage({ type: 'ready', spirit: currentSpirit, runtime: getRuntimeInfo() });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }

    } else if (type === 'get-settings') {
        try {
            await ensureRuntimeSettingsLoaded();
            respondToRequest(requestId, {
                type: 'get-settings-result',
                ...getSettingsPayload(),
            });
        } catch (err) {
            respondToRequest(requestId, { type: 'get-settings-result', error: err.message });
        }

    } else if (type === 'apply-settings') {
        try {
            await ensureRuntimeSettingsLoaded();
            const nextSettings = normalizeSettings(e.data.settings || {});
            const current = runtimeSettings;

            const needsReload =
                nextSettings.provider !== current.provider ||
                nextSettings.webllmModel !== current.webllmModel ||
                nextSettings.openai.baseUrl !== current.openai.baseUrl ||
                nextSettings.openai.apiKey !== current.openai.apiKey ||
                nextSettings.openai.model !== current.openai.model;

            runtimeSettings = nextSettings;
            await persistRuntimeSettings();

            if (needsReload) {
                await loadBackend({ force: true });
                self.postMessage({ type: 'runtime-updated', runtime: getRuntimeInfo() });
            }

            respondToRequest(requestId, {
                type: 'apply-settings-result',
                ...getSettingsPayload(),
            });
        } catch (err) {
            respondToRequest(requestId, { type: 'apply-settings-result', error: err.message });
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
            self.postMessage({
                type: 'ready',
                spirit: currentSpirit,
                restored: true,
                source: 'switch',
                runtime: getRuntimeInfo(),
            });
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
