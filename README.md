# Solchi Gaming AI Assistant

게이밍 테마의 AI 챗봇으로, 구글 로그인 기능과 코드블록 실행 기능을 제공합니다.

## 🚀 주요 기능

- **AI 챗봇**: Gemini API 기반 대화
- **구글 로그인**: OAuth 2.0 인증
- **코드블록**: 문법 하이라이팅 및 실행
- **마크다운 지원**: 풍부한 텍스트 포맷팅
- **대화 기록**: 로그인 시 서버 저장, 비로그인 시 로컬 저장

## 🛠️ 설치 및 실행

### 로컬 실행
```bash
npm install
node gemini_chatbot.js
```

### 환경 변수 설정
- `api.env`: Gemini API, Google Search API 키
- `id.env`: Google OAuth 클라이언트 ID/Secret

## 🌐 배포

### Railway 배포
1. GitHub에 코드 업로드
2. Railway에서 GitHub 연동
3. 환경 변수 설정
4. 자동 배포 완료

### Google OAuth 설정
배포 후 Google Cloud Console에서 승인된 리디렉션 URI를 배포 URL로 변경:
```
https://your-app-name.railway.app/auth/google/callback
```

## 📝 사용법

1. **게스트 모드**: 바로 대화 시작
2. **로그인**: 구글 계정으로 로그인하여 대화 기록 저장
3. **코드 실행**: JavaScript, HTML 코드 블록에서 실행 버튼 클릭
4. **코드 복사**: 코드블록의 복사 버튼으로 클립보드에 복사

## 🎮 게이밍 기능

- 게이밍 테마 UI
- 게임 관련 키워드 인식
- 끝말잇기 게임 모드
- 에이전트 루프 모드

## 🔧 기술 스택

- **Backend**: Node.js, Express
- **AI**: Google Gemini API
- **Auth**: Passport.js, Google OAuth 2.0
- **Frontend**: HTML, CSS, JavaScript
- **Deployment**: Railway

## 📄 라이선스

MIT License 
