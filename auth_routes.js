// 인증 관련 라우트
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

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
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

// 인증 라우트 설정 함수
function setupAuthRoutes(app) {
    // 세션 설정
    app.use(require('express-session')({
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
}

module.exports = { setupAuthRoutes, users, userChats }; 