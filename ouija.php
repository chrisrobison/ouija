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

// Get .env data 
$ENV = [];
$lines = preg_split("/\n/", file_get_contents(".env"));
foreach ($lines as $line) {
    list($key, $val) = preg_split("/=/", $line, 2);
    $ENV[$key] = $val;
}

// ---------------------------
// CONFIG
// ---------------------------
$API_KEY      = getenv('DEEPSEEK_API_KEY') ?: $ENV['DEEPSEEK_API_KEY'];
$MODEL        = 'deepseek-chat';           // or deepseek-reasoner
$TEMPERATURE  = 0.2;
$MAX_TOKENS   = 512;
$MEM_DEPTH    = 30;                        // how many turns to keep in memory

$BASE_DIR     = __DIR__;
$SPIRITS_DIR  = $BASE_DIR . '/spirits';
$CURRENT_FILE = $SPIRITS_DIR . '/current_spirit.txt';

if (!is_dir($SPIRITS_DIR)) {
    mkdir($SPIRITS_DIR, 0755, true);
}

cleanup_spirits_dir($SPIRITS_DIR);

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
- If the user asks to speak with a different spirit, respond ONLY with "<<NEW_SPIRIT>>".
EOT;
// "<<NEW_SPIRIT>>" is used by the frontend to trigger backend spirit switching

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
        CURLOPT_TIMEOUT        => 120,
    ]);

    error_log("DEBUG: Making DeepSeek API request");
    file_put_contents("spirits/ai.log", date('Y-m-d H:i:s') . " REQUEST: " . json_encode($payload) . "\n", FILE_APPEND);

    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new Exception("DeepSeek request failed: $err");
    }
    curl_close($ch);

    error_log("DEBUG: DeepSeek API response code: $httpCode");
    file_put_contents("spirits/ai.log", date('Y-m-d H:i:s') . " RESPONSE ($httpCode): " . $resp . "\n", FILE_APPEND);

    $data = json_decode($resp, true);
    if (!isset($data['choices'][0]['message']['content'])) {
        throw new Exception("DeepSeek bad response (HTTP $httpCode): " . $resp);
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

function is_valid_spirit($data) {
    return is_array($data)
        && isset($data['_id'], $data['profile'], $data['conversation'])
        && is_array($data['conversation']);
}

function cleanup_spirits_dir($SPIRITS_DIR) {
    foreach (glob("$SPIRITS_DIR/*.json") as $file) {
        $data = json_decode(file_get_contents($file), true);
        if (!is_valid_spirit($data)) {
            @unlink($file);
        }
    }
}

function load_spirit($SPIRITS_DIR, $name) {
    $path = "$SPIRITS_DIR/$name.json";
    if (!file_exists($path)) return null;
    $data = json_decode(file_get_contents($path), true);
    if (!is_valid_spirit($data)) {
        // remove invalid file to avoid future mismatches
        @unlink($path);
        return null;
    }
    return $data;
}

function save_spirit($SPIRITS_DIR, $spirit) {
    $name = $spirit['_id'];
    $path = "$SPIRITS_DIR/$name.json";
    $result = file_put_contents($path, json_encode($spirit, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    if ($result === false) {
        throw new Exception("Failed to save spirit file: $path");
    }
    error_log("DEBUG: Saved spirit to: $path");
}

function save_current_spirit_name($CURRENT_FILE, $name) {
    $result = file_put_contents($CURRENT_FILE, $name);
    if ($result === false) {
        throw new Exception("Failed to save current spirit file: $CURRENT_FILE");
    }
    error_log("DEBUG: Set current spirit to: $name");
}

function summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE) {
    // Generate randomization elements
    $eras = ['1800s', '1900s', '1700s', '1600s', 'Medieval times', 'Ancient times', 'Victorian era', 'Renaissance'];
    $locations = ['England', 'France', 'Germany', 'Italy', 'Spain', 'Ireland', 'Scotland', 'America', 'Russia', 'India', 'China', 'Egypt'];
    $occupations = ['farmer', 'merchant', 'soldier', 'sailor', 'blacksmith', 'baker', 'weaver', 'scholar', 'artist', 'musician', 'healer', 'priest', 'noble', 'servant'];
    
    $randomEra = $eras[array_rand($eras)];
    $randomLocation = $locations[array_rand($locations)];
    $randomOccupation = $occupations[array_rand($occupations)];
    $randomSeed = rand(1000, 9999);

    // Dedicated system prompt for spirit creation only
    $creationPrompt = <<<EOT
You are a spirit profile generator. Create unique, historically believable spirit profiles for a Ouija board application.

Each spirit should be:
- From different time periods and locations
- Have realistic occupations for their era  
- Have believable life stories
- Be completely unique from previous spirits
- NOT based on famous historical figures

Output ONLY valid minified JSON with no additional text, formatting, or explanation.
EOT;

    $jsonInstruction = <<<JSONPROMPT
Create a completely unique spirit profile. Be maximally creative and varied.

Randomization seed: $randomSeed
Suggested era: $randomEra
Suggested location: $randomLocation
Suggested occupation: $randomOccupation

Use these as loose inspiration but create someone totally unique.

Required JSON format:
{"name":"...","gender":"...","birthplace":"...","birth_year":0,"death_year":0,"death_cause":"...","occupation":"...","children":0,"note":"..."}
JSONPROMPT;

    // Use the creation-specific prompt, NOT the main system prompt
    $resp = deepseek_chat(
        $API_KEY,
        $MODEL,
        [
            ['role' => 'system', 'content' => $creationPrompt],  // ← Fixed!
            ['role' => 'user',   'content' => $jsonInstruction]
        ],
        0.8,  // Higher temperature for variety
        $MAX_TOKENS
    );

    // Rest of your existing code...
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

function find_spirit_by_name($SPIRITS_DIR, $searchName) {
    $searchName = strtolower(trim($searchName));
    if (empty($searchName)) return null;

    $spirits = [];
    $exactMatches = [];
    $partialMatches = [];

    // Load all spirits
    foreach (glob("$SPIRITS_DIR/*.json") as $file) {
        $data = json_decode(file_get_contents($file), true);
        if (!is_valid_spirit($data)) continue;

        $spiritName = strtolower($data['profile']['name']);
        $spiritId = $data['_id'];

        // Exact match (highest priority)
        if ($spiritName === $searchName) {
            $exactMatches[] = ['id' => $spiritId, 'name' => $data['profile']['name'], 'data' => $data];
        }
        // Partial match
        else if (strpos($spiritName, $searchName) !== false || strpos($searchName, $spiritName) !== false) {
            $partialMatches[] = ['id' => $spiritId, 'name' => $data['profile']['name'], 'data' => $data];
        }
    }

    // Return best match
    if (!empty($exactMatches)) {
        return $exactMatches[0]; // Return first exact match
    }
    if (count($partialMatches) === 1) {
        return $partialMatches[0]; // Return single partial match
    }
    if (count($partialMatches) > 1) {
        return ['multiple' => $partialMatches]; // Return multiple matches for user to choose
    }

    return null; // No matches found
}


// ---------------------------
// ACTIONS
// ---------------------------

// RESET: create a new spirit with debugging
if ($action === 'reset') {
    try {
        error_log("DEBUG: Starting reset action");
        
        // Check if directories exist and are writable
        if (!is_dir($SPIRITS_DIR)) {
            error_log("DEBUG: Creating spirits directory: $SPIRITS_DIR");
            if (!mkdir($SPIRITS_DIR, 0755, true)) {
                throw new Exception("Cannot create spirits directory");
            }
        }
        
        if (!is_writable($SPIRITS_DIR)) {
            throw new Exception("Spirits directory not writable: $SPIRITS_DIR");
        }
        
        // Check API key
        if (empty($API_KEY)) {
            throw new Exception("API key is empty");
        }
        
        error_log("DEBUG: About to summon new spirit");
        $spirit = summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
        error_log("DEBUG: Spirit created with ID: " . $spirit['_id']);
        
        echo "New spirit created: " . $spirit['_id'];
        
    } catch (Exception $e) {
        error_log("DEBUG: Reset failed - " . $e->getMessage());
        http_response_code(500);
        echo "Reset failed: " . $e->getMessage();
    }
    exit;
}

// LIST: list known spirits with details
if ($action === 'list') {
    $spirits = [];
    foreach (glob("$SPIRITS_DIR/*.json") as $f) {
        $data = json_decode(file_get_contents($f), true);
        if (is_valid_spirit($data)) {
            $spirits[] = $data;
        }
    }
    
    if (empty($spirits)) {
        echo "No spirits found";
        exit;
    }
    
    $current = load_current_spirit_name($CURRENT_FILE);
    
    echo "Available spirits:\n\n";
    foreach ($spirits as $spirit) {
        $profile = $spirit['profile'];
        $isCurrent = ($spirit['_id'] === $current) ? " [CURRENT]" : "";
        
        echo "• " . $profile['name'] . $isCurrent . "\n";
        echo "  " . $profile['occupation'] . " from " . $profile['birthplace'] . 
             " (" . $profile['birth_year'] . "-" . $profile['death_year'] . ")\n";
        echo "  ID: " . $spirit['_id'] . "\n\n";
    }
    exit;
}

// SWITCH: switch current host spirit by name (partial matching supported)
if ($action === 'switch') {
    if ($name === '') {
        echo "Error: No spirit name provided";
        exit;
    }
    
    $result = find_spirit_by_name($SPIRITS_DIR, $name);
    
    if ($result === null) {
        echo "No spirit found matching '$name'";
        exit;
    }
    
    if (isset($result['multiple'])) {
        // Multiple matches found - show options
        echo "Multiple spirits found matching '$name':\n\n";
        foreach ($result['multiple'] as $i => $spirit) {
            $profile = $spirit['data']['profile'];
            echo ($i + 1) . ". " . $spirit['name'] . 
                 " (" . $profile['occupation'] . " from " . $profile['birthplace'] . 
                 ", " . $profile['birth_year'] . "-" . $profile['death_year'] . ")\n";
        }
        echo "\nUse exact name to switch to specific spirit.";
        exit;
    }
    
    // Single match found - switch to it
    save_current_spirit_name($CURRENT_FILE, $result['id']);
    echo "Switched to spirit: " . $result['name'];
    exit;
}

// SEARCH: find spirits by name
if ($action === 'search') {
    if ($name === '') {
        echo "Error: No search term provided";
        exit;
    }

    $result = find_spirit_by_name($SPIRITS_DIR, $name);

    if ($result === null) {
        echo "No spirits found matching '$name'";
        exit;
    }

    if (isset($result['multiple'])) {
        echo "Found " . count($result['multiple']) . " spirits matching '$name':\n\n";
        foreach ($result['multiple'] as $spirit) {
            $profile = $spirit['data']['profile'];
            echo "• " . $spirit['name'] . "\n";
            echo "  " . $profile['occupation'] . " from " . $profile['birthplace'] .
                 " (" . $profile['birth_year'] . "-" . $profile['death_year'] . ")\n";
            echo "  ID: " . $spirit['id'] . "\n\n";
        }
    } else {
        $profile = $result['data']['profile'];
        echo "Found: " . $result['name'] . "\n";
        echo $profile['occupation'] . " from " . $profile['birthplace'] .
             " (" . $profile['birth_year'] . "-" . $profile['death_year'] . ")\n";
        echo "ID: " . $result['id'];
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

    // Ensure we start with a valid conversation array
    $conversation = [];
    if (isset($spirit['conversation']) && is_array($spirit['conversation'])) {
        $conversation = $spirit['conversation'];
    }

    // Record the newest user question
    $conversation[] = ['role' => 'user', 'content' => $question];

    // Limit stored history to MEM_DEPTH question/answer pairs
    if (count($conversation) > ($MEM_DEPTH * 2)) {
        $conversation = array_slice($conversation, -($MEM_DEPTH * 2));
    }

    // Build full message array: system prompt, profile, and recent history
    $messages = [
        ['role' => 'system', 'content' => $SYSTEM_PROMPT],
        ['role' => 'system', 'content' => "Spirit Profile:\n" . json_encode($spirit['profile'], JSON_UNESCAPED_UNICODE)]
    ];

    // include recent conversation
    foreach ($conversation as $m) {
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

    // Store assistant response in history
    $conversation[] = ['role' => 'assistant', 'content' => $response];
    if (count($conversation) > ($MEM_DEPTH * 2)) {
        $conversation = array_slice($conversation, -($MEM_DEPTH * 2));
    }

    // Persist updated conversation
    $spirit['conversation'] = $conversation;
    save_spirit($SPIRITS_DIR, $spirit);

    if ($resetToken) {
        // Create and load a new spirit for subsequent requests
        $spirit = summon_new_spirit($API_KEY, $MODEL, $SYSTEM_PROMPT, $TEMPERATURE, $MAX_TOKENS, $SPIRITS_DIR, $CURRENT_FILE);
        $response = "Yes";
    }

    // Output only the spirit's answer
    echo $response;
    exit;
}

// If an unknown action was provided, just end quietly.
exit;
