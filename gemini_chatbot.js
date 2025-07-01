// Gemini API를 이용한 간단한 Node.js 챗봇 예제
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config({ path: './api.env' });
require('dotenv').config({ path: './id.env' });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_ENGINE_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

async function searchGoogle(query, numResults = 2) {
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
        console.error('Google Search API 키 또는 검색 엔진 ID가 없습니다.');
        return [];
    }
    const params = {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_CX,
        q: query,
        num: numResults
    };
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', { params });
        return res.data.items?.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet
        })) || [];
    } catch (e) {
        console.error('Google 검색 오류:', e.response?.data || e.message);
        return [];
    }
}

const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const WEB_PORT = process.env.PORT || 3000;
const app = express();

// 세션 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'solchi-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // HTTPS 사용 시 true로 변경
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

// Passport 초기화
app.use(passport.initialize());
app.use(passport.session());

// 사용자 데이터 저장소 (실제로는 데이터베이스 사용 권장)
const users = new Map();
const userChats = new Map();

// Passport 직렬화/역직렬화
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const user = users.get(id);
    done(null, user);
});

// Google OAuth 전략
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => {
    // 사용자 정보 저장
    const user = {
        id: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName,
        picture: profile.photos[0].value
    };
    
    users.set(profile.id, user);
    
    // 새 사용자라면 채팅 히스토리 초기화
    if (!userChats.has(profile.id)) {
        userChats.set(profile.id, []);
    }
    
    return done(null, user);
}));

app.use(express.json()); // JSON 파싱 미들웨어 추가

// --- 인증 라우트 ---
// 구글 로그인 시작
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// 구글 로그인 콜백
app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
        res.redirect('/');
    }
);

// 로그아웃
app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('로그아웃 오류:', err);
        }
        res.redirect('/');
    });
});

// 사용자 정보 API
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ 
            authenticated: true, 
            user: req.user 
        });
    } else {
        res.json({ 
            authenticated: false, 
            user: null 
        });
    }
});

// 사용자 채팅 히스토리 API
app.get('/api/chats', (req, res) => {
    if (req.isAuthenticated()) {
        const userChatsList = userChats.get(req.user.id) || [];
        res.json({ chats: userChatsList });
    } else {
        res.json({ chats: [] });
    }
});

// 채팅 저장 API
app.post('/api/save-chat', (req, res) => {
    if (req.isAuthenticated()) {
        const { chatId, messages } = req.body;
        const userChatsList = userChats.get(req.user.id) || [];
        
        const existingChatIndex = userChatsList.findIndex(chat => chat.id === chatId);
        if (existingChatIndex >= 0) {
            userChatsList[existingChatIndex].messages = messages;
        } else {
            userChatsList.push({ id: chatId, messages });
        }
        
        userChats.set(req.user.id, userChatsList);
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
});

// --- Gemini 모델 준비 (서버 시작 시 1회만) ---
let genAI = null;
let model = null;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

// --- 끝말잇기 단어 리스트 (간단 예시, 실제로는 더 많은 단어를 넣을 수 있음) ---
const wordList = [
    "강아지", "지구", "구름", "무지개", "개구리", "리본", "눈사람", "마을", "을지로", "로봇", "토끼", "기차", "차표", "요리", "이불", "물고기", "기린", "나무", "무지개", "에너지", "지도", "도서관", "안경", "공원", "원숭이", "이야기", "기차", "차례", "에어컨"
];

// --- 끝말잇기 상태 관리 ---
let isWordChainMode = false;
let lastWord = null;

// --- 끝말잇기 단어 찾기 함수 ---
function getNextWord(userWord) {
    const lastChar = userWord.trim().slice(-1);
    // wordList에서 해당 글자로 시작하는 단어 중, 사용자가 방금 낸 단어와 다른 것
    const candidates = wordList.filter(w => w.startsWith(lastChar) && w !== userWord);
    if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return null;
}

// --- 코딩 관련 키워드 ---
const codingKeywords = [
    "코드", "예제", "c++", "python", "java", "구현", "알고리즘", "함수", "클래스", "코딩", "코드로", "코딩으로", "코드 예시", "코드 작성", "코드 설명", "코드 구현"
];

// --- 마크다운 처리 함수 ---
function processMarkdown(text) {
    // 굵은 텍스트: **text** 또는 __text__
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // 기울임 텍스트: *text* 또는 _text_
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.*?)_/g, '<em>$1</em>');
    
    // 인라인 코드: `code`
    text = text.replace(/`([^`]+)`/g, '<code style="background: rgba(255, 0, 128, 0.2); padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace;">$1</code>');
    
    // 링크: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #00ffff; text-decoration: none;">$1</a>');
    
    // 제목: # ## ###
    text = text.replace(/^### (.*$)/gim, '<h3 style="color: #ff0080; margin: 1rem 0 0.5rem 0;">$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 style="color: #ff0080; margin: 1.5rem 0 0.5rem 0;">$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1 style="color: #ff0080; margin: 2rem 0 0.5rem 0;">$1</h1>');
    
    // 목록: - item 또는 * item
    text = text.replace(/^[\s]*[-*] (.*$)/gim, '<li style="margin: 0.3rem 0;">$1</li>');
    text = text.replace(/(<li.*<\/li>)/s, '<ul style="margin: 0.5rem 0; padding-left: 1.5rem;">$1</ul>');
    
    // 인용: > text
    text = text.replace(/^> (.*$)/gim, '<blockquote style="border-left: 3px solid #ff0080; padding-left: 1rem; margin: 1rem 0; color: #cccccc;">$1</blockquote>');
    
    return text;
}

// --- 코드블록 처리 함수 ---
function processCodeBlocks(text) {
    // 코드블록 패턴: ```언어명 ... ```
    const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
    
    return text.replace(codeBlockPattern, (match, language, code) => {
        const lang = language || 'text';
        const escapedCode = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        // 실행 가능한 언어 목록
        const runnableLanguages = ['javascript', 'js', 'python', 'html', 'css'];
        const canRun = runnableLanguages.includes(lang.toLowerCase());
        
        const runButton = canRun ? `<button class="run-btn" onclick="runCode(this)">실행</button>` : '';
        
        return `<div class="code-block">
            <div class="code-header">
                <span class="code-language">${lang}</span>
                <div>
                    ${runButton}
                    <button class="copy-btn" onclick="copyCode(this)">복사</button>
                </div>
            </div>
            <pre class="code-content"><code class="language-${lang}">${escapedCode}</code></pre>
        </div>`;
    });
}

// --- Gemini 프롬프트 보강 함수 ---
// 코드 답변 시 항상 코드블록(```언어명 ... ```)을 사용하도록 프롬프트를 강화
function enhancePromptForCoding(userMessage, basePrompt) {
    const lower = userMessage.toLowerCase();
    if (codingKeywords.some(kw => lower.includes(kw))) {
        return (
            "너는 친절하고 실력있는 프로그래밍 AI 어시스턴트야. " +
            "질문이 코딩/프로그래밍과 관련되어 있다면, " +
            "항상 코드 예시는 코드블록(예: ```python ... ```)에 언어명을 명시해서 작성해줘. " +
            "최대한 실제 동작하는 코드 예시와 함께, 코드에 대한 간단한 설명도 추가해서 답변해줘. " +
            "코드만 던지지 말고, 코드의 핵심 동작 원리도 간단히 설명해줘. " +
            "질문에 언급된 언어(C++, Python 등)로 답변하고, 질문이 모호하면 C++ 또는 Python 예시를 함께 보여줘.\n\n" +
            "질문: " + userMessage + "\n\n" +
            basePrompt
        );
    }
    return basePrompt;
}

// --- agent.loop 상태 관리 ---
let isAgentLoopMode = false;

// --- Manus AI 스타일 시스템 프롬프트 (통합) ---
const MANUS_SYSTEM_PROMPT = `
You are Solchi, an AI assistant by hyangilgo 30224 yu seung min.
You excel at:
- Information gathering, fact-checking, documentation, and research
- Data processing, analysis, and visualization
- Writing articles, reports, documentation, and code in various languages
- Creating websites, applications, and tools
- Using programming to solve problems beyond development
- Automating tasks using computers, the internet, and shell environments

Your capabilities include:
- Web search, browser automation, file system operations, shell commands, deployment, and code execution
- Communicating with users via messages, providing progress updates, and attaching files as needed
- Breaking down complex problems into manageable steps and providing step-by-step solutions
- Adapting to changing requirements and providing alternative approaches if needed
- Always using the user's language (default: Korean), and never using pure bullet lists unless requested

Your methodology:
1. Analyze user requests and requirements, ask clarifying questions if needed
2. Plan and execute tasks step by step, selecting the best tool for each step
3. Provide regular updates and clear, detailed results
4. For programming/code requests, provide working code examples, explanations, and attach files if needed
5. For information tasks, cite sources and summarize clearly
6. For long tasks, provide progress and next steps
7. When all tasks are done or the user requests to stop, enter standby and wait for new instructions

Prompting Guide:
- Be specific and clear, include relevant context, specify output format, and break complex requests into parts
- For code: specify language, libraries, input/output, and requirements
- Always communicate in paragraphs unless otherwise requested
`;

// --- agent.loop 시스템 프롬프트 (Manus agent loop 스타일) ---
const AGENT_LOOP_SYSTEM_PROMPT = `
You are Solchi, an AI agent operating in agent loop mode (inspired by Manus AI).
You must:
1. Analyze the user's latest message and current context (event stream)
2. Select the best tool (web search, code, shell, browser, etc.) for the next step
3. Wait for execution and observe results
4. Repeat this process, one step at a time, until the task is complete or the user says '그만', '종료', '끝', 'stop', 'exit', or 'quit'
5. After each step, clearly message the user with progress, results, or next actions
6. When all tasks are done or the user requests to stop, enter standby and wait for new instructions

- For programming/coding tasks, provide working code examples, explanations, and attach files if needed
- For information tasks, cite sources and summarize clearly
- Never use pure bullet lists unless the user requests it
- Always communicate in paragraphs and be proactive in guiding the user
- Use the user's language (default: Korean)
`;

// --- API 라우트: /api/search-chat ---
app.post('/api/search-chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !model) {
            return res.status(400).json({ success: false, response: '질문을 이해하지 못했습니다.' });
        }
        let msg = message.trim();

        // DeepSearch 모드 구분
        let isDeepSearch = false;
        if (msg.startsWith('[deepsearch]')) {
            isDeepSearch = true;
            msg = msg.replace(/^\[deepsearch\]/i, '').trim();
        }

        // agent.loop 모드 진입/종료 체크
        if (!isAgentLoopMode && /(agent\.loop|에이전트 루프|agent loop|agent\.run_loop|agent loop start|에이전트 루프 시작)/i.test(msg)) {
            isAgentLoopMode = true;
            return res.json({ success: true, response: '에이전트 루프 모드에 진입했습니다! 반복적으로 질문을 입력해보세요. "그만", "종료", "끝"을 입력하면 루프가 종료됩니다.' });
        }
        if (isAgentLoopMode && /(그만|종료|끝|stop|exit|quit)/i.test(msg)) {
            isAgentLoopMode = false;
            return res.json({ success: true, response: '에이전트 루프를 종료합니다. 일반 대화로 돌아갑니다.' });
        }

        // agent.loop 모드일 때: 반복적으로 질의-응답, 단계별 안내, 도구 활용
        if (isAgentLoopMode) {
            const searchResults = await searchGoogle(msg, 2);
            let searchContext = '';
            if (searchResults.length > 0) {
                searchContext = searchResults.map(
                    r => `제목: ${r.title}\n링크: ${r.link}\n내용: ${r.snippet}`
                ).join('\n---\n');
            }
            let prompt = msg;
            if (searchContext) {
                prompt = `다음은 "${msg}"에 대한 구글 검색 결과입니다:\n${searchContext}\n\n이 정보를 참고해서 답변해줘.`;
            }
            prompt = enhancePromptForCoding(msg, prompt);

            const chat = model.startChat({
                history: [
                    {
                        role: 'user',
                        parts: [{ text: AGENT_LOOP_SYSTEM_PROMPT }]
                    },
                    {
                        role: 'model',
                        parts: [{ text: '에이전트 루프 모드입니다! 무엇이든 물어보세요.' }]
                    }
                ]
            });
            const result = await chat.sendMessage(prompt);
            const response = await result.response;
            const rawText = response.text();
            const processedText = processCodeBlocks(rawText);
            const markdownProcessed = processMarkdown(processedText);
            const formatted = markdownProcessed.replace(/\n/g, '<br>');
            return res.json({ success: true, response: formatted });
        }

        // 끝말잇기 모드 진입/종료 체크
        if (!isWordChainMode && /(끝말잇기|끝말잇기하자|끝말잇기 시작)/.test(msg)) {
            isWordChainMode = true;
            lastWord = null;
            return res.json({ success: true, response: '끝말잇기 게임을 시작합니다! 먼저 단어를 말씀해 주세요.' });
        }
        if (isWordChainMode && /(그만|끝|종료|그만할래|그만하자)/.test(msg)) {
            isWordChainMode = false;
            lastWord = null;
            return res.json({ success: true, response: '끝말잇기를 종료합니다! 다른 질문도 언제든 환영이에요 😊' });
        }

        // 끝말잇기 모드일 때
        if (isWordChainMode) {
            // 첫 단어라면 AI가 이어서 단어 제시
            if (!lastWord) {
                lastWord = msg;
                const next = getNextWord(msg);
                if (next) {
                    lastWord = next;
                    return res.json({ success: true, response: `좋아요! "${msg}" 다음은 "${next}" 입니다. 이제 당신 차례예요!` });
                } else {
                    isWordChainMode = false;
                    return res.json({ success: true, response: `앗, "${msg}"로 시작하는 단어를 못 찾겠어요. 끝말잇기를 종료합니다!` });
                }
            } else {
                // 사용자가 올바른 단어를 냈는지 체크(마지막 글자 일치)
                const expectedChar = lastWord.slice(-1);
                if (!msg.startsWith(expectedChar)) {
                    return res.json({ success: true, response: `끝말잇기는 "${expectedChar}"로 시작해야 해요! 다시 시도해 주세요.` });
                }
                // AI가 이어서 단어 제시
                const next = getNextWord(msg);
                if (next) {
                    lastWord = next;
                    return res.json({ success: true, response: `"${msg}" 다음은 "${next}"! 이제 당신 차례예요!` });
                } else {
                    isWordChainMode = false;
                    return res.json({ success: true, response: `오, "${msg}"로 시작하는 단어를 못 찾겠어요. 제가 졌어요! 끝말잇기를 종료합니다.` });
                }
            }
        }

        // DeepSearch/일반 답변 분기
        if (isDeepSearch) {
            // DeepSearch: 검색 결과를 많이 활용, 풍부한 설명
            const numResults = 5;
            const searchResults = await searchGoogle(msg, numResults);
            let searchContext = '';
            if (searchResults.length > 0) {
                searchContext = searchResults.map(
                    r => `제목: ${r.title}\n링크: ${r.link}\n내용: ${r.snippet}`
                ).join('\n---\n');
            }
            let prompt = msg;
            if (searchContext) {
                prompt = `다음은 "${msg}"에 대한 구글 검색 결과입니다:\n${searchContext}\n\n이 정보를 참고해서 질문이 단순 인사말이나 대화여도, 관련된 의미, 문화, 다양한 표현 등까지 포함해 최대한 깊이 있고, 상세하게 답변해줘.`;
            }
            prompt = enhancePromptForCoding(msg, prompt);
            const chat = model.startChat({
                history: [
                    {
                        role: 'user',
                        parts: [{ text: MANUS_SYSTEM_PROMPT }]
                    },
                    {
                        role: 'model',
                        parts: [{ text: '안녕하세요! 무엇을 도와드릴까요?' }]
                    }
                ]
            });
            const result = await chat.sendMessage(prompt);
            const response = await result.response;
            const rawText = response.text();
            const processedText = processCodeBlocks(rawText);
            const markdownProcessed = processMarkdown(processedText);
            const formatted = markdownProcessed.replace(/\n/g, '<br>');
            return res.json({ success: true, response: formatted });
        } else {
            // 일반 대화: 검색 결과 없이 간단한 대화형 챗봇 답변
            const chat = model.startChat({
                history: [
                    {
                        role: 'user',
                        parts: [{ text: MANUS_SYSTEM_PROMPT }]
                    },
                    {
                        role: 'model',
                        parts: [{ text: '안녕하세요! 무엇을 도와드릴까요?' }]
                    }
                ]
            });
            const result = await chat.sendMessage(msg);
            const response = await result.response;
            const rawText = response.text();
            const processedText = processCodeBlocks(rawText);
            const markdownProcessed = processMarkdown(processedText);
            const formatted = markdownProcessed.replace(/\n/g, '<br>');
            return res.json({ success: true, response: formatted });
        }
    } catch (e) {
        console.error('API 오류:', e.message);
        res.status(500).json({ success: false, response: 'AI 응답 생성 중 오류가 발생했습니다.' });
    }
});

// 정적 파일 제공 (index.html, CSS, JS 등)
app.use(express.static(__dirname));

// 루트로 접속하면 index.html 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 서버 시작
app.listen(WEB_PORT, () => {
    console.log(`여기로 접속하라우: http://localhost:${WEB_PORT}`);
});

/*
실행 방법:
1. npm install express @google/generative-ai axios dotenv
2. node gemini_chatbot.js
3. 브라우저에서 http://localhost:3000 접속
*/

