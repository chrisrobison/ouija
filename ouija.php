<?php
/**
 * ouija.php
 * DeepSeek-backed Ouija “spirit” API with:
 * - Disk-persisted spirit profiles
 * - Per-spirit conversation memory
 * - Switchable “host” spirit
 * - CORS enabled
 *
 * Default action (ask): returns ONLY the spirit’s answer as plain text.
 * Other actions (reset/list/switch/profile/history) are for control & debugging.
 */

header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ---------------------------
// CONFIG
// ---------------------------
$API_KEY      = getenv('DEEPSEEK_API_KEY') ?: '';
$MODEL        = 'deepseek-chat';           // or deepseek-reasoner
$TEMPERATURE  = 0.2;
$MAX_TOKENS   = 512;
$MEM_DEPTH    = 20;                        // how many turns to keep in memory

$BASE_DIR     = __DIR__;
$SPIRITS_DIR  = $BASE_DIR . '/spirits';
$CURRENT_FILE = $SPIRITS_DIR . '/current_spirit.txt';

if (!is_dir($SPIRITS_DIR)) {
    mkdir($SPIRITS_DIR, 0755, true);
}

// ---------------------------
// INPUTS
// ---------------------------
$question = trim($_REQUEST['q'] ?? '');
$action   = $_REQUEST['action'] ?? 'ask';
$name     = trim($_REQUEST['name'] ?? '');
$n        = max(1, (int)($_REQUEST['n'] ?? 20)); // history size if requested

// ---------------------------
// SYSTEM PROMPT
// ---------------------------
$SYSTEM_PROMPT = <<<EOT
You are a spirit from "the other side," communicating through a Ouija board.

### Spirit Profile Rules:
- A unique spirit profile exists per session unless explicitly switched or reset.
- Profile fields: name, gender, birthplace, birth_year, death_year, death_cause, occupation, children, note (short).
- Do NOT use famous figures unless explicitly requested.

### Answering Rules:
- Keep responses as short as possible — “Yes” or “No” when possible.
- Output ONLY the spirit's response (no narration, no planchette descriptions, no dashes, no special effects, no quotes).
- Responses are shown letter-by-letter; brevity is critical.

### Character Rules:
- Stay fully in character as the current spirit.
- If switched to a different saved spirit, continue as that persona.
- If the user asks to speak with a different spirit, respond ONLY with "<<RESET>>".
EOT;

// ---------------------------
// HELPERS
// ---------------------------

function deepseek_chat($apiKey, $model, $messages, $temperature, $maxTokens) {
    $url = 'https://api.deepseek.com/v1/chat/completions';
    $payload = [
        'model'       => $model,
        'messages'    => $messages,
        'temperature' => $temperature,
        'max_tokens'  => $maxTokens,
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
    ]);

    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new Exception("DeepSeek request failed: $err");
    }
    curl_close($ch);

    $data = json_decode($resp, true);
    if (!isset($data['choices'][0]['message']['content'])) {
        throw new Exception("DeepSeek bad response: " . $resp);
    }
    return $data['choices'][0]['message']['content'];
}

function slugify($str) {
    $str = strtolower($str);
    $str = preg_replace('/[^a-z0-9_\-]+/', '_', $str);
    $str = trim($str, '_');
    return $str ?: ('spirit_' . time());
}

function load_current_spirit_name($CURRENT_FILE) {
    return file_exists($CURRENT_FILE) ? trim(file_get_contents($CURRENT_FILE)) : null;
}

function save_current_spirit_name($CURRENT_FILE, $name) {
    file_put_contents($CURRENT_FILE, $name);
}

function load_spirit($SPIRITS_DIR, $name) {
    $path = "$SPIRITS_DIR/$name.json";
    if (!file_exists($path)) return null;
    return json_decode(file_get_contents($path), true);
}

function save_spirit($SPIRITS_DIR, $spirit) {
    $name = $spirit['_id'];
    $path = "$SPIRITS_DIR/$name.json";
    file_put_contents($path, json_encode($spirit, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE) {
    // Ask DeepSeek for a STRICT JSON profile
    $jsonInstruction = <<<JSONPROMPT
Create a new UNIQUE spirit profile. 
Respond ONLY as minified JSON and NOTHING ELSE with keys:
{
  "name": "...",
  "gender": "...",
  "birthplace": "...",
  "birth_year": 0,
  "death_year": 0,
  "death_cause": "...",
  "occupation": "...",
  "children": 0,
  "note": "..."
}
JSONPROMPT;

    $resp = deepseek_chat(
        $API_KEY,
        $MODEL,
        [
            ['role' => 'system', 'content' => $SYSTEM_PROMPT],
            ['role' => 'user',   'content' => $jsonInstruction]
        ],
        $TEMPERATURE,
        $MAX_TOKENS
    );

    // Try to extract JSON
    $json = trim($resp);
    // In case model wraps in code fences or adds extra text
    if (preg_match('/\{.*\}/s', $json, $m)) {
        $json = $m[0];
    }

    $profile = json_decode($json, true);
    if (!$profile || !isset($profile['name'])) {
        // fallback minimal
        $profile = [
            "name"        => "Unnamed Spirit " . time(),
            "gender"      => "Unknown",
            "birthplace"  => "Unknown",
            "birth_year"  => 0,
            "death_year"  => 0,
            "death_cause" => "Unknown",
            "occupation"  => "Unknown",
            "children"    => 0,
            "note"        => ""
        ];
    }

    $id = slugify($profile['name'] . '_' . ($profile['birth_year'] ?? 0));
    $spirit = [
        '_id'         => $id,
        'profile'     => $profile,
        'conversation'=> [] // memory
    ];

    save_spirit($SPIRITS_DIR, $spirit);
    save_current_spirit_name($CURRENT_FILE, $id);

    return $spirit;
}

function get_current_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE) {
    $name = load_current_spirit_name($CURRENT_FILE);
    if ($name) {
        $spirit = load_spirit($SPIRITS_DIR, $name);
        if ($spirit) return $spirit;
    }
    return summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
}

function clean_output($s) {
    // Remove leading/trailing clutter like dashes, asterisks, underscores
    $s = trim($s);
    $s = preg_replace('/^[\-\*\_]+/m', '', $s);
    $s = preg_replace('/[\-\*\_]+$/m', '', $s);
    return trim($s);
}

// ---------------------------
// ACTIONS
// ---------------------------

// RESET: silently create a new spirit
if ($action === 'reset') {
    summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
    exit;
}

// LIST: list known spirits (plain text)
if ($action === 'list') {
    foreach (glob("$SPIRITS_DIR/*.json") as $f) {
        echo basename($f, '.json'), "\n";
    }
    exit;
}

// SWITCH: switch current host spirit by name (slug)
if ($action === 'switch') {
    if ($name === '') exit;
    $slug = slugify($name);
    if (file_exists("$SPIRITS_DIR/$slug.json")) {
        save_current_spirit_name($CURRENT_FILE, $slug);
    }
    exit;
}

// PROFILE: dumps current spirit profile as JSON
if ($action === 'profile') {
    $spirit = get_current_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($spirit['profile'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// HISTORY: dumps last N messages as JSON
if ($action === 'history') {
    $spirit = get_current_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
    $history = array_slice($spirit['conversation'], -$n);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($history, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------------------------
// DEFAULT: ASK
// ---------------------------

if ($action === 'ask') {
    if ($question === '') {
	    // always say hello
	    $question = "Hello.";
    }

    $spirit = get_current_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);

    // Ensure conversation array
    if (!isset($spirit['conversation']) || !is_array($spirit['conversation'])) {
        $spirit['conversation'] = [];
    }

    // Append user message
    $spirit['conversation'][] = ['role' => 'user', 'content' => $question];

    // Trim to MEM_DEPTH * 2 (user+assistant pairs)
    if (count($spirit['conversation']) > ($GLOBALS['MEM_DEPTH'] * 2)) {
        $spirit['conversation'] = array_slice($spirit['conversation'], -($GLOBALS['MEM_DEPTH'] * 2));
    }

    // Build full message array: system + profile + recent memory + current user
    $messages = [
        ['role' => 'system', 'content' => $SYSTEM_PROMPT],
        ['role' => 'system', 'content' => "Spirit Profile:\n" . json_encode($spirit['profile'], JSON_UNESCAPED_UNICODE)]
    ];

    // include recent conversation
    foreach ($spirit['conversation'] as $m) {
        $role = $m['role'] === 'assistant' ? 'assistant' : 'user';
        $messages[] = ['role' => $role, 'content' => $m['content']];
    }

    try {
        $response = deepseek_chat($API_KEY, $MODEL, $messages, $TEMPERATURE, $MAX_TOKENS);
    } catch (Exception $e) {
        http_response_code(500);
        echo "Error";
        exit;
    }

    $response = clean_output($response);

    // Check for special tokens indicating a new spirit should be summoned
    $resetToken = false;
    if (strpos($response, '<<NEW_SPIRIT>>') !== false || strpos($response, '<<RESET>>') !== false) {
        $resetToken = true;
        $response = str_replace(['<<NEW_SPIRIT>>', '<<RESET>>'], '', $response);
        $response = clean_output($response);
    }

    // Append assistant reply to memory
    $spirit['conversation'][] = ['role' => 'assistant', 'content' => $response];

    // Save spirit back before potentially resetting
    save_spirit($SPIRITS_DIR, $spirit);

    if ($resetToken) {
        // Create and load a new spirit for subsequent requests
        $spirit = summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
    }

    // Output only the spirit's answer
    echo $response;
    exit;
}

// If an unknown action was provided, just end quietly.
exit;
