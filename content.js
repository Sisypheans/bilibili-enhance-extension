// ==================== B站功能增强 - Content Script ====================

(function() {
    'use strict';

    // ==================== 默认配置 ====================
    const DEFAULT_CONFIG = {
        maxSkipDuration: 130 * 60,
        minSkipDuration: 5,
        skipMarginStart: 0,
        skipMarginEnd: 3,
        groupFromTolerance: 5,
        groupToTolerance: 5,
        maxDanmakuLength: 20,
        skippedTolerance: 2,
        notificationDuration: 3000,
        secondsPerRightClick: 5,
        debug: false,
        matchRules: [
            { label: '跳伞/跳伞:', keywords: ['跳伞', '跳伞:'], type: 'time_target', keyword_direction: 'left', allow_gap: false },
            { label: '右点/右键/右', keywords: ['右点', '右键', '右'], type: 'click_count', keyword_direction: 'left', allow_gap: false },
            { label: '空降/空降:', keywords: ['空降:', '空降'], type: 'time_target', keyword_direction: 'left', allow_gap: false },
            { label: '绯红之王', keywords: ['绯红之王'], type: 'time_target', keyword_direction: 'left', allow_gap: false },
            { label: '工程', keywords: ['工程'], type: 'time_target', keyword_direction: 'right', allow_gap: true },
        ],
        danmakuSkipEnabled: true,
        danmakuSkipNotify: true,
        danmakuAutoLike: true,
        autoPlay: false,
        skipStart: false,
        skipEnd: false,
        skipStartSec: 0,
        skipEndSec: 0,
    };

    let CONFIG = { ...DEFAULT_CONFIG };
    let configLoaded = false;

    // ==================== 存储操作（chrome.storage.sync） ====================
    function loadConfig() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(null, (items) => {
                if (chrome.runtime.lastError) {
                    console.warn('[B站增强] 读取配置失败，使用默认配置');
                    CONFIG = { ...DEFAULT_CONFIG };
                } else {
                    CONFIG = { ...DEFAULT_CONFIG, ...items };
                    // matchRules 需要单独合并，避免被空数组覆盖
                    if (!items.matchRules || !Array.isArray(items.matchRules) || items.matchRules.length === 0) {
                        CONFIG.matchRules = [...DEFAULT_CONFIG.matchRules];
                    }
                }
                configLoaded = true;
                resolve();
            });
        });
    }

    function saveConfig() {
        chrome.storage.sync.set(CONFIG, () => {
            if (chrome.runtime.lastError) {
                console.warn('[B站增强] 保存配置失败:', chrome.runtime.lastError.message);
            }
        });
    }

    // 监听配置变化
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            for (const key in changes) {
                CONFIG[key] = changes[key].newValue;
            }
            // 配置变化时重新应用设置（弹幕跳过相关）
            if (configLoaded && state.initialized) {
                applyAllSettings();
                if (CONFIG.danmakuSkipEnabled && !state.danmakuProcessed) {
                    processDanmakuForVideo();
                } else if (!CONFIG.danmakuSkipEnabled) {
                    // 关闭弹幕跳过时移除监听器
                    setupDanmakuSkip();
                }
                // 更新页内 UI（徽章 + 模态框）
                updateToolbarBadge();
                if (state.modalCreated) {
                    updateSwitchUI('danmaku-skip');
                }
            }
        }
    });

    // ==================== 页面级状态（仅当前页面生效，新页面重置） ====================
    const PAGE_STATE_KEYS = {
        autoPlay: 'bili_page_autoplay',
        skipStart: 'bili_page_skipstart',
        skipEnd: 'bili_page_skipend',
        skipStartSec: 'bili_page_skipstart_sec',
        skipEndSec: 'bili_page_skipend_sec',
    };

    function getPageState(key) {
        const val = sessionStorage.getItem(PAGE_STATE_KEYS[key]);
        if (key === 'skipStartSec' || key === 'skipEndSec') {
            const defaultKey = key;
            return val !== null ? parseInt(val) : CONFIG[defaultKey];
        }
        return val === 'true';
    }

    function setPageState(key, value) {
        if (key === 'skipStartSec' || key === 'skipEndSec') {
            sessionStorage.setItem(PAGE_STATE_KEYS[key], String(value));
        } else {
            sessionStorage.setItem(PAGE_STATE_KEYS[key], value ? 'true' : 'false');
        }
    }

    // 监听来自 popup 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'getPageState') {
            sendResponse({
                autoPlay: getPageState('autoPlay'),
                skipStart: getPageState('skipStart'),
                skipEnd: getPageState('skipEnd'),
                skipStartSec: getPageState('skipStartSec'),
                skipEndSec: getPageState('skipEndSec'),
            });
            return true;
        }
        if (message.type === 'setPageState') {
            const { key, value } = message;
            if (PAGE_STATE_KEYS[key]) {
                setPageState(key, value);
                applyAllSettings();
                // 更新页内 UI（徽章 + 模态框）
                updateToolbarBadge();
                if (state.modalCreated) {
                    if (key === 'autoPlay') updateSwitchUI('autoplay');
                    else if (key === 'skipStart') updateSwitchUI('skipstart');
                    else if (key === 'skipEnd') updateSwitchUI('skipend');
                }
                sendResponse({ ok: true });
            } else {
                sendResponse({ ok: false, error: '未知的状态键' });
            }
            return true;
        }
        if (message.type === 'setSkipStartSec') {
            setPageState('skipStartSec', message.value);
            applySkipStartSetting(getPageState('skipStart'));
            // 更新页内 UI
            if (state.modalCreated) {
                updateSecondsInput('skipstart');
            }
            sendResponse({ ok: true });
            return true;
        }
        if (message.type === 'setSkipEndSec') {
            setPageState('skipEndSec', message.value);
            applySkipEndSetting(getPageState('skipEnd'));
            // 更新页内 UI
            if (state.modalCreated) {
                updateSecondsInput('skipend');
            }
            sendResponse({ ok: true });
            return true;
        }
    });

    // ==================== 状态管理 ====================
    const state = {
        initialized: false,
        lastUrl: location.href,
        modalCreated: false,
        buttonInserted: false,
        danmakuSegments: [],
        danmakuHighlights: [],
        skippedSegments: new Set(),
        lastSkipTime: 0,
        danmakuProcessed: false,
        loadedSegMax: 0,
        allDanmakuMatches: [],
        isLoadingSegments: false,
    };

    // ==================== 网络请求封装（通过background） ====================
    function bgFetch(url, options = {}, responseType = 'json') {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'fetch', url, options, responseType },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.ok) {
                        resolve(response.body);
                    } else {
                        reject(new Error(response ? response.error || '请求失败' : '无响应'));
                    }
                }
            );
        });
    }

    function getWbiSignedUrl(baseUrl, params) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'wbi_sign', baseUrl, params },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.ok) {
                        resolve(response.signedUrl);
                    } else {
                        reject(new Error(response ? response.error : 'WBI签名失败'));
                    }
                }
            );
        });
    }

    // ==================== 工具函数 ====================
    function formatTime(seconds) {
        if (seconds < 0) return '--:--';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function _debugLog(msg, isWarn) {
        if (!CONFIG.debug) return;
        if (isWarn) console.warn(msg);
        else console.log(msg);
    }

    // ==================== 跳过通知 ====================
    const NOTIFICATION_COLOR = '#fb7299';
    let notificationTimer = null;

    function getNotificationContainer() {
        const selectors = [
            '.bpx-player-container',
            '.bilibili-player',
            '#bilibili-player',
            '.player-container',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return document.body;
    }

    function showSkipNotification(title, desc) {
        if (!CONFIG.danmakuSkipNotify) return;

        const container = getNotificationContainer();
        const isInPlayer = container !== document.body;

        let notif = document.getElementById('bili-enhance-notification');
        if (!notif) {
            notif = document.createElement('div');
            notif.id = 'bili-enhance-notification';
        }

        if (notif.parentElement !== container) {
            container.appendChild(notif);
        }

        const positionType = isInPlayer ? 'absolute' : 'fixed';
        const topDistance = isInPlayer ? '20px' : '80px';

        notif.style.cssText = `
            position: ${positionType}; top: ${topDistance}; left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(0, 0, 0, 0.85); color: white;
            padding: 12px 20px; border-radius: 8px;
            z-index: 999999; opacity: 0;
            transition: opacity 0.3s, transform 0.3s;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
            max-width: 400px; border-left: 4px solid ${NOTIFICATION_COLOR};
        `;
        notif.innerHTML = `
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;"></div>
            <div style="font-size: 12px; opacity: 0.8;"></div>
        `;

        const divs = notif.querySelectorAll('div');
        divs[0].textContent = title;
        divs[1].textContent = desc;

        requestAnimationFrame(() => {
            notif.style.opacity = '1';
            notif.style.transform = 'translateX(-50%) translateY(0)';
        });

        clearTimeout(notificationTimer);
        notificationTimer = setTimeout(() => {
            notif.style.opacity = '0';
            notif.style.transform = 'translateX(-50%) translateY(-20px)';
        }, CONFIG.notificationDuration);
    }

    // ==================== 自动连播功能 ====================
    let autoPlayNextHandler = null;

    function applyAutoPlaySetting(enabled) {
        if (typeof window.player !== 'undefined') {
            try {
                if (window.player.setAutoPlay) window.player.setAutoPlay(enabled);
            } catch (e) {
                console.warn('[B站增强] player.setAutoPlay 调用失败:', e);
            }
        }

        const autoplayBtn = document.querySelector('.bpx-player-ctrl-autoplay, .bilibili-player-video-btn-autoplay, .squirtle-video-autoplay');
        if (autoplayBtn) {
            const isActive = autoplayBtn.classList.contains('on') || autoplayBtn.classList.contains('active');
            if (enabled !== isActive) autoplayBtn.click();
        }

        if (enabled) setupAutoPlayNextVideo();
        else removeAutoPlayNextVideo();
    }

    function setupAutoPlayNextVideo() {
        const video = document.querySelector('video');
        if (!video) return;
        if (autoPlayNextHandler) video.removeEventListener('ended', autoPlayNextHandler);

        autoPlayNextHandler = function() {
            setTimeout(() => {
                const nextBtn = document.querySelector('.bpx-player-ctrl-next, .bilibili-player-video-btn-next, .squirtle-video-next, .video-pod-next');
                if (nextBtn) { nextBtn.click(); return; }
                const nextItem = document.querySelector('.list-item.active + .list-item, .video-episode-item.current + .video-episode-item');
                if (nextItem) { nextItem.click(); return; }
                const currentPart = document.querySelector('.cur-page, .on');
                if (currentPart && currentPart.parentElement) {
                    const nextPart = currentPart.nextElementSibling;
                    if (nextPart) nextPart.click();
                }
            }, 1000);
        };
        video.addEventListener('ended', autoPlayNextHandler);
    }

    function removeAutoPlayNextVideo() {
        if (!autoPlayNextHandler) return;
        const video = document.querySelector('video');
        if (video) video.removeEventListener('ended', autoPlayNextHandler);
        autoPlayNextHandler = null;
    }

    // ==================== 开头跳过功能 ====================
    let skipStartHandler = null;
    let skipStartDone = false;

    function applySkipStartSetting(enabled) {
        const video = document.querySelector('video');
        if (!video) return;

        if (skipStartHandler) {
            video.removeEventListener('play', skipStartHandler);
            skipStartHandler = null;
        }

        if (enabled) {
            skipStartDone = false;
            skipStartHandler = function() {
                if (skipStartDone) return;
                const sec = getPageState('skipStartSec');
                // 时长限制：跳过秒数不能大于总时长 - 10秒，否则不跳过
                if (sec > 0 && video.duration && sec <= video.duration - 10 && video.currentTime < sec) {
                    video.currentTime = sec;
                    console.log('[B站增强] 开头跳过', sec, '秒');
                    showSkipNotification(
                        `已跳过开头 ${formatTime(sec)}`,
                        `从 0:00 跳到 ${formatTime(sec)}`
                    );
                }
                skipStartDone = true;
            };
            video.addEventListener('play', skipStartHandler);
            if (!video.paused) skipStartHandler();
        }
    }

    // ==================== 结尾跳过功能 ====================
    let skipEndHandler = null;
    let skipEndDone = false;

    function applySkipEndSetting(enabled) {
        const video = document.querySelector('video');
        if (!video) return;

        if (skipEndHandler) {
            video.removeEventListener('timeupdate', skipEndHandler);
            skipEndHandler = null;
        }

        if (enabled) {
            skipEndDone = false;
            skipEndHandler = function() {
                if (skipEndDone) return;
                const sec = getPageState('skipEndSec');
                if (sec <= 0 || !video.duration) return;
                // 时长限制：剩余时长不能大于总时长 - 10秒，否则不跳过
                if (sec > video.duration - 10) return;
                const remaining = video.duration - video.currentTime;
                if (remaining <= sec) {
                    skipEndDone = true;
                    console.log('[B站增强] 结尾跳过，剩余', remaining.toFixed(1), '秒');
                    showSkipNotification(
                        `已跳过结尾 ${formatTime(remaining)}`,
                        `即将播放下一个视频`
                    );
                    const nextBtn = document.querySelector('.bpx-player-ctrl-next, .bilibili-player-video-btn-next, .squirtle-video-next, .video-pod-next');
                    if (nextBtn) { nextBtn.click(); return; }
                    const nextItem = document.querySelector('.list-item.active + .list-item, .video-episode-item.current + .video-episode-item');
                    if (nextItem) { nextItem.click(); return; }
                    const currentPart = document.querySelector('.cur-page, .on');
                    if (currentPart && currentPart.parentElement) {
                        const nextPart = currentPart.nextElementSibling;
                        if (nextPart) nextPart.click();
                    }
                }
            };
            video.addEventListener('timeupdate', skipEndHandler);
        }
    }

    // ==================== 弹幕解析器 ====================
    const DanmakuParser = {
        chineseNumToInt(str) {
            const map = { '零':0, '一':1, '二':2, '两':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10, '百':100, '千':1000 };
            if (/^\d+$/.test(str)) return parseInt(str);
            if (map[str] !== undefined) return map[str];
            if (/^十[一二三四五六七八九]$/.test(str)) return 10 + map[str[1]];
            if (/^[一二三四五六七八九]十$/.test(str)) return map[str[0]] * 10;
            if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(str)) return map[str[0]] * 10 + map[str[2]];
            return 0;
        },

        preprocess(text) {
            if (!text) return '';
            text = text.replace(/\s+/g, '');
            text = text.replace(/[!！]/g, '');
            text = text.replace(/：/g, ':');
            return text;
        },

        parseTimeStr(str) {
            if (!str) return -1;
            let m = str.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
            if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
            m = str.match(/^(\d{1,2}):(\d{2})$/);
            if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
            m = str.match(/^(\d+)分(\d+)秒?$/);
            if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
            m = str.match(/^(\d+)分$/);
            if (m) return parseInt(m[1]) * 60;
            m = str.match(/^(\d{2})(\d{2})$/);
            if (m) {
                const minutes = parseInt(m[1]);
                const seconds = parseInt(m[2]);
                if (seconds <= 59) return minutes * 60 + seconds;
            }
            m = str.match(/^(\d)(\d{2})$/);
            if (m) {
                const minutes = parseInt(m[1]);
                const seconds = parseInt(m[2]);
                if (minutes >= 1 && seconds <= 59) return minutes * 60 + seconds;
            }
            return -1;
        },

        buildRegexForRule(rule) {
            const keywordGroup = rule.keywords.join('|');
            const direction = rule.keyword_direction || 'left';
            const allowGap = rule.allow_gap === true;
            const gap = allowGap ? '.*?' : '';

            if (rule.type === 'time_target') {
                const timePattern = '\\d{1,2}:\\d{2}:\\d{2}|\\d{4}|\\d{3}|\\d{1,2}:\\d{2}|\\d+分\\d*秒?';
                if (direction === 'left') {
                    return { regex: new RegExp(`(?:${keywordGroup})${gap}(${timePattern})`), timeGroup: 1 };
                } else if (direction === 'right') {
                    return { regex: new RegExp(`(${timePattern})${gap}(?:${keywordGroup})`), timeGroup: 1 };
                } else {
                    return { regex: new RegExp(`(?:${keywordGroup})${gap}(${timePattern})|(${timePattern})${gap}(?:${keywordGroup})`), timeGroup: 'either' };
                }
            } else if (rule.type === 'click_count') {
                const numPattern = '[一二三四五六七八九十百千\\d]+';
                if (direction === 'left') {
                    return { regex: new RegExp(`(${keywordGroup})${gap}(${numPattern})下`), keywordGroup: 1, numGroup: 2 };
                } else if (direction === 'right') {
                    return { regex: new RegExp(`(${numPattern})下${gap}(${keywordGroup})`), keywordGroup: 2, numGroup: 1 };
                } else {
                    return { regex: new RegExp(`(${keywordGroup})${gap}(${numPattern})下|(${numPattern})下${gap}(?:${keywordGroup})`), keywordGroup: 'either_kw', numGroup: 'either_num' };
                }
            }
            return null;
        },

        parseDanmaku(originalText, dmTime, dmid) {
            const results = [];
            if (!originalText) return results;
            if (originalText.length > CONFIG.maxDanmakuLength) return results;

            const text = this.preprocess(originalText);
            if (!text) return results;

            for (const rule of CONFIG.matchRules) {
                const built = this.buildRegexForRule(rule);
                if (!built || !built.regex) continue;

                const match = text.match(built.regex);
                if (!match) continue;

                if (rule.type === 'time_target') {
                    let timeStr = '';
                    if (built.timeGroup === 'either') {
                        timeStr = match[1] || match[2] || '';
                    } else {
                        timeStr = match[built.timeGroup] || '';
                    }
                    const targetTime = this.parseTimeStr(timeStr);
                    if (targetTime > 0) {
                        results.push({
                            type: 'jump', from: dmTime, to: targetTime,
                            reason: originalText, label: rule.label,
                            dmTime, dmText: originalText, dmid,
                        });
                        return results;
                    }
                } else if (rule.type === 'click_count') {
                    let keyword = '', countStr = '';
                    if (built.keywordGroup === 'either_kw') {
                        if (match[1] && match[2]) { keyword = match[1]; countStr = match[2]; }
                        else if (match[3] && match[4]) { countStr = match[3]; keyword = match[4]; }
                    } else {
                        keyword = match[built.keywordGroup] || '';
                        countStr = match[built.numGroup] || '';
                    }
                    const count = this.chineseNumToInt(countStr);
                    if (count > 0 && count <= 120) {
                        const skipSeconds = count * CONFIG.secondsPerRightClick;
                        results.push({
                            type: 'jump', from: dmTime, to: dmTime + skipSeconds,
                            reason: originalText, label: keyword + count + '下',
                            dmTime, dmText: originalText, dmid,
                        });
                        return results;
                    }
                }
            }
            return results;
        },

        parseAndFilter(danmakuList) {
            const matches = [];
            for (const dm of danmakuList) {
                const results = this.parseDanmaku(dm.text, dm.time, dm.dmid);
                for (const result of results) {
                    const skipDuration = result.to - result.from;
                    if (skipDuration < CONFIG.minSkipDuration || skipDuration > CONFIG.maxSkipDuration) continue;
                    matches.push(result);
                }
            }
            return matches;
        },

        groupMatches(allMatches) {
            if (allMatches.length === 0) return [];

            const xTolerance = CONFIG.groupFromTolerance || 3;
            const yTolerance = CONFIG.groupToTolerance || 5;

            const groups = [];
            for (const match of allMatches) {
                let placed = false;
                for (const g of groups) {
                    const xClose = Math.abs(match.from - g.maxFrom) <= xTolerance;
                    const yClose = Math.abs(match.to - g.minTo) <= yTolerance;
                    if (xClose && yClose) {
                        g.items.push(match);
                        if (match.from > g.maxFrom) g.maxFrom = match.from;
                        if (match.to < g.minTo) g.minTo = match.to;
                        g.label = g.label || match.label;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    groups.push({
                        items: [match],
                        maxFrom: match.from,
                        minTo: match.to,
                        count: 1,
                        label: match.label,
                    });
                }
            }

            for (const g of groups) {
                g.count = g.items.length;
                let maxFrom = -Infinity, minTo = Infinity;
                for (const item of g.items) {
                    if (item.from > maxFrom) maxFrom = item.from;
                    if (item.to < minTo) minTo = item.to;
                }
                g.maxFrom = maxFrom;
                g.minTo = minTo;
            }

            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 0; i < groups.length; i++) {
                    for (let j = i + 1; j < groups.length; j++) {
                        const a = groups[i];
                        const b = groups[j];
                        const overlap = !(a.minTo < b.maxFrom || b.minTo < a.maxFrom);
                        if (overlap) {
                            let winnerIdx, loserIdx;
                            if (a.count > b.count) { winnerIdx = i; loserIdx = j; }
                            else if (b.count > a.count) { winnerIdx = j; loserIdx = i; }
                            else {
                                const mergedFrom = Math.max(a.maxFrom, b.maxFrom);
                                const mergedTo = Math.min(a.minTo, b.minTo);
                                a.maxFrom = mergedFrom;
                                a.minTo = mergedTo;
                                winnerIdx = i;
                                loserIdx = j;
                            }
                            const winner = groups[winnerIdx];
                            const loser = groups[loserIdx];
                            winner.items.push(...loser.items);
                            winner.count = winner.items.length;
                            groups.splice(loserIdx, 1);
                            changed = true;
                            break;
                        }
                    }
                    if (changed) break;
                }
            }

            groups.sort((a, b) => a.maxFrom - b.maxFrom);

            const segments = [];
            for (const g of groups) {
                const skipDuration = g.minTo - g.maxFrom;
                if (skipDuration < CONFIG.minSkipDuration || skipDuration > CONFIG.maxSkipDuration) continue;
                segments.push({
                    avgFrom: g.maxFrom,
                    avgTo: g.minTo,
                    count: g.count,
                    sources: g.items,
                    reason: g.items[0].dmText,
                    label: g.label,
                    type: 'jump',
                });
            }
            return segments;
        },

        parseAll(danmakuList) {
            const allMatches = this.parseAndFilter(danmakuList);
            const segments = this.groupMatches(allMatches);
            return { segments, highlights: allMatches, allMatches, totalDanmaku: danmakuList.length, matchedCount: allMatches.length };
        },
    };

    // ==================== 弹幕获取 ====================
    const DanmakuFetcher = {
        getBvid() {
            const match = location.pathname.match(/(BV[0-9A-Za-z]+)/);
            return match ? match[1] : null;
        },

        getCidFromWindow() {
            try {
                if (window.__INITIAL_STATE__) {
                    const s = window.__INITIAL_STATE__;
                    if (s.videoData && s.videoData.cid) return s.videoData.cid;
                    if (s.epInfo && s.epInfo.cid) return s.epInfo.cid;
                    if (s.h1Title && s.cid) return s.cid;
                }
            } catch (e) {}
            try {
                if (window.__playinfo__ && window.__playinfo__.data) {
                    const d = window.__playinfo__.data;
                    if (d.cid) return d.cid;
                }
            } catch (e) {}
            try {
                if (window.player) {
                    if (typeof window.player.getCid === 'function') return window.player.getCid();
                    if (window.player.cid) return window.player.cid;
                }
            } catch (e) {}
            try {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const text = script.textContent || '';
                    const cidMatch = text.match(/"cid"\s*:\s*(\d+)/);
                    if (cidMatch) return parseInt(cidMatch[1]);
                }
            } catch (e) {}
            return null;
        },

        getPageFromUrl() {
            try {
                const params = new URLSearchParams(location.search);
                const p = params.get('p');
                if (p) {
                    const n = parseInt(p);
                    if (n > 0) return n;
                }
            } catch (e) {}
            return 1;
        },

        async getCidFromApi(bvid) {
            const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
            const data = await bgFetch(url, { method: 'GET' }, 'json');
            if (data && data.code === 0 && data.data) {
                return data.data;
            }
            throw new Error('API返回错误: ' + (data ? data.message : 'unknown'));
        },

        async getCidFromPagelist(bvid) {
            const url = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}&jsonp=jsonp`;
            const data = await bgFetch(url, { method: 'GET' }, 'json');
            if (data && data.code === 0 && data.data && data.data.length > 0) {
                return data.data;
            }
            throw new Error('分P列表获取失败');
        },

        async getCid() {
            const page = this.getPageFromUrl();
            const localCid = this.getCidFromWindow();
            const bvid = this.getBvid();

            if (page === 1 && localCid) {
                console.log('[弹幕跳过] 从页面获取CID:', localCid);
                return localCid;
            }

            if (page > 1 && bvid) {
                try {
                    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData
                        && window.__INITIAL_STATE__.videoData.pages) {
                        const pages = window.__INITIAL_STATE__.videoData.pages;
                        if (pages[page - 1] && pages[page - 1].cid) {
                            const cid = pages[page - 1].cid;
                            console.log(`[弹幕跳过] 从页面分P列表获取CID(P${page}):`, cid);
                            return cid;
                        }
                    }
                } catch (e) {}

                try {
                    const apiData = await this.getCidFromApi(bvid);
                    if (apiData.pages && apiData.pages[page - 1] && apiData.pages[page - 1].cid) {
                        const cid = apiData.pages[page - 1].cid;
                        console.log(`[弹幕跳过] 从API分P列表获取CID(P${page}):`, cid);
                        return cid;
                    }
                } catch (e) {
                    _debugLog(`[弹幕跳过] 视频详情API失败: ${e.message}`);
                }

                try {
                    const pages = await this.getCidFromPagelist(bvid);
                    if (pages[page - 1] && pages[page - 1].cid) {
                        const cid = pages[page - 1].cid;
                        console.log(`[弹幕跳过] 从分P列表接口获取CID(P${page}):`, cid);
                        return cid;
                    }
                } catch (e) {
                    _debugLog(`[弹幕跳过] 分P列表接口失败: ${e.message}`);
                }
            }

            if (localCid) {
                console.log('[弹幕跳过] 从页面获取CID:', localCid);
                return localCid;
            }

            if (bvid) {
                try {
                    const apiData = await this.getCidFromApi(bvid);
                    if (apiData.cid) {
                        console.log('[弹幕跳过] 从API获取CID:', apiData.cid);
                        return apiData.cid;
                    }
                } catch (e) {
                    _debugLog(`[弹幕跳过] API获取CID失败: ${e.message}`);
                }
            }

            throw new Error('无法获取视频CID');
        },

        async fetchXmlDanmaku(cid) {
            const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
            const xmlText = await bgFetch(url, { method: 'GET' }, 'text');
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'text/xml');
            const dElements = doc.getElementsByTagName('d');
            const danmakuList = [];
            for (let i = 0; i < dElements.length; i++) {
                const d = dElements[i];
                const p = d.getAttribute('p');
                const text = d.textContent;
                if (p && text) {
                    const parts = p.split(',');
                    const time = parseFloat(parts[0]);
                    danmakuList.push({ time, text });
                }
            }
            if (danmakuList.length === 0) throw new Error('弹幕列表为空');
            return danmakuList;
        },

        async fetchSegment(cid, segIdx) {
            try {
                const signedUrl = await getWbiSignedUrl(
                    'https://api.bilibili.com/x/v2/dm/wbi/web/seg.so',
                    { type: 1, oid: cid, segment_index: segIdx }
                );
                const result = await this._fetchProtoUrl(signedUrl);
                if (result.ok) return result;
            } catch (e) {
                _debugLog(`[弹幕跳过] WBI接口失败: ${e.message}`);
            }

            return this._fetchProtoUrl(`https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${segIdx}`);
        },

        async _fetchProtoUrl(url) {
            try {
                const data = await bgFetch(url, { method: 'GET' }, 'arraybuffer');
                const buf = new Uint8Array(data);
                const dmList = this._parseDanmakuProto(buf);
                return { data: dmList, ok: true };
            } catch (e) {
                return { data: [], ok: false };
            }
        },

        _parseDanmakuProto(buf) {
            const danmakuList = [];
            let i = 0;
            const debug = CONFIG.debug;
            let _totalIterations = 0;
            const MAX_ITER = 100000;

            const readVarint = (offset) => {
                let result = 0;
                let shift = 0;
                let pos = offset;
                let iter = 0;
                while (pos < buf.length && iter < 10) {
                    const b = buf[pos];
                    result |= (b & 0x7f) << shift;
                    pos++;
                    iter++;
                    if (!(b & 0x80)) break;
                    shift += 7;
                    if (shift > 63) break;
                }
                return { value: result, nextOffset: pos };
            };

            while (i < buf.length) {
                _totalIterations++;
                if (_totalIterations > MAX_ITER) {
                    console.error(`[诊断] _parseDanmakuProto 超过${MAX_ITER}次迭代，强制退出。当前i=${i}, buf.length=${buf.length}`);
                    break;
                }

                if (buf[i] !== 0x0a) { i++; continue; }

                const msgLenResult = readVarint(i + 1);
                const msgEnd = msgLenResult.nextOffset + msgLenResult.value;

                if (msgEnd > buf.length || msgEnd <= msgLenResult.nextOffset) {
                    if (debug) {
                        console.warn(`[诊断] msgEnd异常: i=${i}, msgLen=${msgLenResult.value}, msgEnd=${msgEnd}, bufLen=${buf.length}`);
                    }
                    i++;
                    continue;
                }

                let time = 0;
                let text = '';
                let dmid = '';
                let scanPos = msgLenResult.nextOffset;
                let innerIter = 0;

                while (scanPos < msgEnd) {
                    innerIter++;
                    if (debug && innerIter > 50) {
                        console.warn(`[诊断] 单条弹幕字段扫描超过50次，scanPos=${scanPos}, msgEnd=${msgEnd}`);
                        break;
                    }
                    const tagResult = readVarint(scanPos);
                    const wireType = tagResult.value & 0x07;
                    const fieldNum = tagResult.value >>> 3;

                    if (wireType === 0) {
                        if (fieldNum === 1) {
                            let val = 0n, mult = 1n, pos = tagResult.nextOffset;
                            let bigIter = 0;
                            while (pos < msgEnd && bigIter < 10) {
                                const b = buf[pos];
                                val += BigInt(b & 0x7f) * mult;
                                pos++;
                                bigIter++;
                                if (!(b & 0x80)) break;
                                mult *= 128n;
                            }
                            dmid = val.toString();
                            scanPos = pos;
                        } else {
                            const valResult = readVarint(tagResult.nextOffset);
                            if (fieldNum === 2) {
                                time = valResult.value / 1000;
                            }
                            scanPos = valResult.nextOffset;
                        }
                    } else if (wireType === 2) {
                        const lenResult = readVarint(tagResult.nextOffset);
                        const dataStart = lenResult.nextOffset;
                        const dataEnd = dataStart + lenResult.value;
                        if (dataEnd > msgEnd || dataEnd < dataStart) {
                            if (debug) {
                                console.warn(`[诊断] 字符串长度异常: field=${fieldNum}, len=${lenResult.value}, dataEnd=${dataEnd}, msgEnd=${msgEnd}`);
                            }
                            scanPos = msgEnd;
                            break;
                        }
                        if (fieldNum === 7 && lenResult.value > 0 && lenResult.value < 200) {
                            try {
                                const bytes = buf.slice(dataStart, dataEnd);
                                const decoded = new TextDecoder('utf-8').decode(bytes);
                                if (decoded && decoded.length > 0) {
                                    text = decoded;
                                }
                            } catch (e) {}
                        }
                        scanPos = dataEnd;
                    } else {
                        break;
                    }
                }

                if (text && time >= 0) {
                    danmakuList.push({ time, text, dmid });
                }

                i = msgEnd;
            }

            return danmakuList;
        },

        async fetchDanmaku() {
            const cid = await this.getCid();
            const video = document.querySelector('video');
            const currentSeg = video && video.currentTime >= 0
                ? Math.floor(video.currentTime / 360) + 1
                : 1;
            const targetSegMax = currentSeg + 1;

            console.log(`[弹幕跳过] 初始加载分段 1-${targetSegMax}（当前播放位置分段 ${currentSeg}）`);

            const promises = [];
            for (let i = 1; i <= targetSegMax; i++) {
                promises.push(this.fetchSegment(cid, i));
            }
            const results = await Promise.all(promises);
            const allDanmaku = [];
            let anyOk = false;
            for (const result of results) {
                if (result.ok) anyOk = true;
                allDanmaku.push(...result.data);
            }

            if (!anyOk && allDanmaku.length === 0) {
                console.log('[弹幕跳过] protobuf接口全部失败，尝试XML接口...');
                try {
                    const xmlDm = await this.fetchXmlDanmaku(cid);
                    allDanmaku.push(...xmlDm);
                    console.log('[弹幕跳过] XML接口获取成功');
                } catch (e) {
                    _debugLog(`[弹幕跳过] XML接口也失败: ${e.message}`);
                }
            }

            state.loadedSegMax = targetSegMax;
            console.log(`[弹幕跳过] 初始获取到 ${allDanmaku.length} 条弹幕`);
            return allDanmaku;
        },
    };

    // ==================== 弹幕跳过控制器 ====================
    let danmakuTimeHandler = null;
    let danmakuLazyLoadHandler = null;

    function setupDanmakuSkip() {
        const video = document.querySelector('video');
        if (!video) return;

        if (danmakuTimeHandler) {
            video.removeEventListener('timeupdate', danmakuTimeHandler);
            danmakuTimeHandler = null;
        }
        if (danmakuLazyLoadHandler) {
            video.removeEventListener('timeupdate', danmakuLazyLoadHandler);
            danmakuLazyLoadHandler = null;
        }

        if (!CONFIG.danmakuSkipEnabled) return;

        danmakuTimeHandler = function() {
            if (state.danmakuSegments.length === 0) return;

            const currentTime = video.currentTime;
            if (Date.now() - state.lastSkipTime < 1000) return;

            for (let i = 0; i < state.danmakuSegments.length; i++) {
                const seg = state.danmakuSegments[i];
                const startTime = seg.avgFrom + CONFIG.skipMarginStart;
                const endTime = seg.avgTo - CONFIG.skipMarginEnd;

                if (isSegmentSkipped(seg.avgTo)) continue;

                if (currentTime >= startTime && currentTime < endTime) {
                    doDanmakuSkip(seg);
                    break;
                }
            }
        };

        danmakuLazyLoadHandler = function() {
            if (state.isLoadingSegments) return;

            const currentSeg = Math.floor(video.currentTime / 360) + 1;
            if (currentSeg + 1 > state.loadedSegMax) {
                _debugLog(`[诊断] 触发懒加载: currentSeg=${currentSeg}, loadedMax=${state.loadedSegMax}`);
                loadMoreDanmakuSegments(currentSeg + 1);
            }
        };

        video.addEventListener('timeupdate', danmakuTimeHandler);
        video.addEventListener('timeupdate', danmakuLazyLoadHandler);
    }

    function isSegmentSkipped(avgTo) {
        for (const skipped of state.skippedSegments) {
            if (Math.abs(avgTo - skipped) <= CONFIG.skippedTolerance) return true;
        }
        return false;
    }

    async function loadMoreDanmakuSegments(targetSegMax) {
        if (state.isLoadingSegments) return;
        state.isLoadingSegments = true;

        try {
            const cid = await DanmakuFetcher.getCid();
            const fromSeg = Math.max(state.loadedSegMax + 1, targetSegMax - 1);
            console.log(`[弹幕跳过] 懒加载分段 ${fromSeg}-${targetSegMax}（跳过中间分段）`);

            const promises = [];
            for (let i = fromSeg; i <= targetSegMax; i++) {
                promises.push(DanmakuFetcher.fetchSegment(cid, i));
            }
            const results = await Promise.all(promises);

            let newDanmakuCount = 0;
            for (const result of results) {
                if (result.data.length > 0) newDanmakuCount += result.data.length;
            }

            if (newDanmakuCount > 0) {
                const newMatchesAll = [];
                for (const result of results) {
                    if (result.data.length === 0) continue;
                    const newMatches = DanmakuParser.parseAndFilter(result.data);
                    state.allDanmakuMatches.push(...newMatches);
                    newMatchesAll.push(...newMatches);
                }

                state.danmakuSegments = DanmakuParser.groupMatches(state.allDanmakuMatches);
                console.log(`[弹幕跳过] 懒加载完成，新增 ${newDanmakuCount} 条弹幕，当前 ${state.allDanmakuMatches.length} 条匹配`);

                if (newMatchesAll.length > 0 && CONFIG.danmakuAutoLike) {
                    autoLikeDanmaku(newMatchesAll);
                }
            }

            state.loadedSegMax = targetSegMax;
        } catch (e) {
            console.warn('[弹幕跳过] 懒加载失败:', e.message);
        } finally {
            state.isLoadingSegments = false;
        }
    }

    function doDanmakuSkip(segment) {
        const video = document.querySelector('video');
        if (!video) return;

        const targetTime = segment.avgTo;
        const skipDuration = targetTime - video.currentTime;
        if (skipDuration < 1) return;

        state.skippedSegments.add(Math.round(targetTime));
        state.lastSkipTime = Date.now();
        video.currentTime = targetTime;

        showSkipNotification(
            `已跳过 ${formatTime(skipDuration)} 片段`,
            `从 ${formatTime(segment.avgFrom)} 到 ${formatTime(segment.avgTo)} · ${segment.label}`
        );

        console.log('[B站增强] 弹幕跳过:', segment.label, formatTime(segment.avgFrom), '→', formatTime(segment.avgTo));
    }

    async function processDanmakuForVideo() {
        state.danmakuSegments = [];
        state.danmakuHighlights = [];
        state.skippedSegments.clear();
        state.danmakuProcessed = false;
        state.loadedSegMax = 0;
        state.allDanmakuMatches = [];
        state.isLoadingSegments = false;

        const maxRetries = 3;
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 1000));

                const danmakuList = await DanmakuFetcher.fetchDanmaku();
                console.log(`[弹幕跳过] 获取到 ${danmakuList.length} 条弹幕`);

                state.allDanmakuMatches = DanmakuParser.parseAndFilter(danmakuList);
                state.danmakuSegments = DanmakuParser.groupMatches(state.allDanmakuMatches);
                state.danmakuProcessed = true;

                console.log(`[弹幕跳过] 分析完成：${state.danmakuSegments.length} 个跳过段，${state.allDanmakuMatches.length} 条匹配`);

                setupDanmakuSkip();
                if (CONFIG.danmakuAutoLike) {
                    autoLikeDanmaku(state.allDanmakuMatches);
                }
                return;
            } catch (e) {
                lastError = e;
                console.warn(`[弹幕跳过] 第${attempt + 1}次尝试失败:`, e.message);
            }
        }

        console.error('[弹幕跳过] 处理失败:', lastError);
    }

    // ==================== 弹幕自动点赞 ====================
    function getCsrfToken() {
        const match = document.cookie.match(/bili_jct\s*=\s*([^\s;]+)/);
        return match ? match[1] : '';
    }

    async function queryDanmakuLikeStatus(cid, dmids) {
        if (dmids.length === 0) return {};
        const idsParam = dmids.join(',');
        const url = `https://api.bilibili.com/x/v2/dm/thumbup/stats?oid=${cid}&ids=${idsParam}`;
        try {
            const data = await bgFetch(url, { method: 'GET' }, 'json');
            if (data.code === 0 && data.data) {
                return data.data;
            }
            return {};
        } catch (e) {
            return {};
        }
    }

    async function thumbupDanmaku(cid, dmid, csrf) {
        const url = 'https://api.bilibili.com/x/v2/dm/thumbup/add';
        const params = new URLSearchParams();
        params.append('dmid', dmid);
        params.append('oid', cid);
        params.append('op', '1');
        params.append('platform', 'web_player');
        params.append('csrf', csrf);
        try {
            const data = await bgFetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params.toString(),
            }, 'json');
            return data.code === 0;
        } catch (e) {
            return false;
        }
    }

    async function autoLikeDanmaku(matches) {
        const validMatches = matches.filter(m => m.dmid);
        if (validMatches.length === 0) return;

        const csrf = getCsrfToken();
        if (!csrf) {
            console.log('[弹幕点赞] 未登录，跳过点赞');
            return;
        }

        const cid = await DanmakuFetcher.getCid();
        const dmids = [...new Set(validMatches.map(m => m.dmid))];

        const stats = await queryDanmakuLikeStatus(cid, dmids);
        const toLike = dmids.filter(id => {
            const stat = stats[id];
            return !stat || stat.user_like === 0;
        });

        if (toLike.length === 0) {
            console.log('[弹幕点赞] 所有匹配弹幕已点赞');
            return;
        }

        console.log(`[弹幕点赞] 待点赞 ${toLike.length}/${dmids.length} 条`);
        let success = 0;
        for (const dmid of toLike) {
            const ok = await thumbupDanmaku(cid, dmid, csrf);
            if (ok) success++;
            await new Promise(r => setTimeout(r, 1500));
        }
        console.log(`[弹幕点赞] 完成 ${success}/${toLike.length} 条点赞成功`);
    }

    // ==================== 视频切换检测（自动连播/选集切换后重置跳过状态） ====================
    let videoLoadedDataHandler = null;
    let lastVideoSrc = '';

    function setupVideoChangeDetector() {
        const video = document.querySelector('video');
        if (!video) return;

        if (videoLoadedDataHandler) {
            video.removeEventListener('loadeddata', videoLoadedDataHandler);
        }

        lastVideoSrc = video.currentSrc || '';

        videoLoadedDataHandler = function() {
            const currentSrc = video.currentSrc || '';
            if (!currentSrc || currentSrc === lastVideoSrc) return;
            lastVideoSrc = currentSrc;

            // 视频切换了，重置所有跳过状态
            skipStartDone = false;
            skipEndDone = false;
            state.danmakuProcessed = false;
            state.skippedSegments.clear();
            state.loadedSegMax = 0;
            state.allDanmakuMatches = [];
            state.isLoadingSegments = false;

            console.log('[B站增强] 检测到视频切换，重置跳过状态');

            // 重新应用开头跳过（视频已加载，直接执行）
            if (getPageState('skipStart')) {
                const sec = getPageState('skipStartSec');
                if (sec > 0 && video.duration && sec <= video.duration - 10 && video.currentTime < sec) {
                    video.currentTime = sec;
                    console.log('[B站增强] 开头跳过（视频切换后）', sec, '秒');
                    showSkipNotification(
                        `已跳过开头 ${formatTime(sec)}`,
                        `从 0:00 跳到 ${formatTime(sec)}`
                    );
                }
                skipStartDone = true;
            }

            // 重新处理弹幕跳过
            if (CONFIG.danmakuSkipEnabled) {
                processDanmakuForVideo();
            }
        };

        video.addEventListener('loadeddata', videoLoadedDataHandler);
    }

    // ==================== 应用所有设置 ====================
    function applyAllSettings() {
        const video = document.querySelector('video');
        if (!video) return;

        applyAutoPlaySetting(getPageState('autoPlay'));
        applySkipStartSetting(getPageState('skipStart'));
        applySkipEndSetting(getPageState('skipEnd'));
        setupDanmakuSkip();
        setupVideoChangeDetector();
    }

    // ==================== 页内工具栏按钮 & 模态框 ====================
    const ENHANCE_BTN_ID = 'bili-enhance-toolbar-btn';

    // 获取徽章四位数字文本：弹幕跳过/自动连播/开头跳过/结尾跳过
    function getBadgeText() {
        const a = CONFIG.danmakuSkipEnabled ? '1' : '0';
        const b = getPageState('autoPlay') ? '1' : '0';
        const c = getPageState('skipStart') ? '1' : '0';
        const d = getPageState('skipEnd') ? '1' : '0';
        return `${a}${b}${c}${d}`;
    }

    function isButtonInserted() {
        return document.getElementById(ENHANCE_BTN_ID) !== null;
    }

    // 更新工具栏按钮上的四位数字徽章
    function updateToolbarBadge() {
        const badge = document.querySelector('.video-enhance-info-text');
        if (badge) badge.textContent = getBadgeText();
    }

    // 在分享按钮右侧插入增强功能按钮
    function insertEnhanceButton() {
        if (isButtonInserted()) return true;

        const shareWrap = document.querySelector('.video-share-wrap');
        if (!shareWrap) return false;

        const toolbarItemWrap = shareWrap.closest('.toolbar-left-item-wrap');
        if (!toolbarItemWrap) return false;

        const newItemWrap = document.createElement('div');
        newItemWrap.className = 'toolbar-left-item-wrap';
        newItemWrap.setAttribute('data-v-c03e7bcc', '');
        newItemWrap.id = ENHANCE_BTN_ID;

        const enhanceBtn = document.createElement('div');
        enhanceBtn.className = 'video-enhance-wrap video-toolbar-left-item';
        enhanceBtn.setAttribute('data-v-c03e7bcc', '');
        enhanceBtn.title = '功能增强';
        enhanceBtn.style.cursor = 'pointer';

        // 加号SVG图标
        enhanceBtn.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" class="video-enhance-icon video-toolbar-item-icon">
                <path d="M14 5V23M5 14H23" stroke="currentColor" stroke-width="7" stroke-linecap="round" fill="none"/>
            </svg>
            <div class="video-enhance-info video-toolbar-item-text">
                <span class="video-enhance-info-text">${getBadgeText()}</span>
            </div>
        `;

        enhanceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal();
        });

        newItemWrap.appendChild(enhanceBtn);
        toolbarItemWrap.after(newItemWrap);

        state.buttonInserted = true;
        console.log('[B站增强] 功能按钮已插入');
        return true;
    }

    // ==================== 模态框 ====================
    function createModal() {
        if (state.modalCreated) return;

        const overlay = document.createElement('div');
        overlay.id = 'bili-enhance-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5); z-index: 999998;
            display: none; opacity: 0; transition: opacity 0.2s ease;
        `;

        const modal = document.createElement('div');
        modal.id = 'bili-enhance-modal';
        modal.style.cssText = `
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%) scale(0.9);
            background: #fff; border-radius: 12px; z-index: 999999;
            display: none; opacity: 0;
            transition: opacity 0.2s ease, transform 0.2s ease;
            min-width: 380px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        `;

        const dsOn = CONFIG.danmakuSkipEnabled;
        const apOn = getPageState('autoPlay');
        const ssOn = getPageState('skipStart');
        const seOn = getPageState('skipEnd');
        const ssSec = getPageState('skipStartSec');
        const seSec = getPageState('skipEndSec');

        modal.innerHTML = `
            <div style="padding: 20px 24px; border-bottom: 1px solid #e3e5e7;">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #18191C;">功能增强</h3>
            </div>
            <div style="padding: 16px 24px 24px;">
                <!-- 1. 弹幕自动跳过 -->
                <div class="enhance-row" data-feature="danmaku-skip" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; cursor: pointer;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 6C2 4.89543 2.89543 4 4 4H16C17.1046 4 18 4.89543 18 6V14C18 15.1046 17.1046 16 16 16H4C2.89543 16 2 15.1046 2 14V6Z" fill="#fb7299"/>
                            <path d="M7 7L13 10L7 13V7Z" fill="white"/>
                        </svg>
                        <span style="font-size: 14px; color: #18191C;">弹幕自动跳过</span>
                    </div>
                    <div class="enhance-switch" data-feature="danmaku-skip" style="
                        position: relative; width: 40px; height: 22px;
                        border-radius: 11px; background: ${dsOn ? '#fb7299' : '#E3E5E7'};
                        transition: background 0.2s ease; flex-shrink: 0;
                    ">
                        <div class="enhance-switch-dot" style="
                            position: absolute; top: 2px; left: ${dsOn ? '20px' : '2px'};
                            width: 18px; height: 18px; border-radius: 50%; background: #fff;
                            transition: left 0.2s ease; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                        "></div>
                    </div>
                </div>

                <!-- 2. 自动连播 -->
                <div style="border-top: 1px solid #f0f1f3;"></div>
                <div class="enhance-row" data-feature="autoplay" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; cursor: pointer;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 2C10.5523 2 11 2.44772 11 3V9H17C17.5523 9 18 9.44772 18 10C18 10.5523 17.5523 11 17 11H11V17C11 17.5523 10.5523 18 10 18C9.44772 18 9 17.5523 9 17V11H3C2.44772 11 2 10.5523 2 10C2 9.44772 2.44772 9 3 9H9V3C9 2.44772 9.44772 2 10 2Z" fill="#61666D"/>
                        </svg>
                        <span style="font-size: 14px; color: #18191C;">自动连播</span>
                    </div>
                    <div class="enhance-switch" data-feature="autoplay" style="
                        position: relative; width: 40px; height: 22px;
                        border-radius: 11px; background: ${apOn ? '#fb7299' : '#E3E5E7'};
                        transition: background 0.2s ease; flex-shrink: 0;
                    ">
                        <div class="enhance-switch-dot" style="
                            position: absolute; top: 2px; left: ${apOn ? '20px' : '2px'};
                            width: 18px; height: 18px; border-radius: 50%; background: #fff;
                            transition: left 0.2s ease; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                        "></div>
                    </div>
                </div>

                <!-- 3. 开头跳过 -->
                <div style="border-top: 1px solid #f0f1f3;"></div>
                <div class="enhance-row" data-feature="skipstart" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div style="display: flex; align-items: center; gap: 12px; cursor: pointer;" class="enhance-toggle-area" data-feature="skipstart">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 4L14 10L6 16V4Z" fill="#61666D"/>
                            <rect x="2" y="4" width="2" height="12" rx="1" fill="#61666D"/>
                        </svg>
                        <span style="font-size: 14px; color: #18191C;">开头跳过</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 0; border-radius: 6px; overflow: hidden; border: 1px solid #e3e5e7;">
                            <button class="enhance-stepper-btn" data-action="dec" data-target="skipstart" style="
                                width: 28px; height: 28px; border: none; background: #f1f2f3;
                                cursor: pointer; font-size: 16px; color: #61666D;
                                display: flex; align-items: center; justify-content: center;
                            ">−</button>
                            <input type="text" inputmode="numeric" value="${ssSec}" id="enhance-skipstart-sec" style="
                                width: 44px; height: 28px; border: none;
                                border-left: 1px solid #e3e5e7; border-right: 1px solid #e3e5e7;
                                text-align: center; font-size: 13px; color: #18191C; background: #fff;
                                outline: none; -moz-appearance: textfield;
                            ">
                            <button class="enhance-stepper-btn" data-action="inc" data-target="skipstart" style="
                                width: 28px; height: 28px; border: none; background: #f1f2f3;
                                cursor: pointer; font-size: 16px; color: #61666D;
                                display: flex; align-items: center; justify-content: center;
                            ">+</button>
                        </div>
                        <span style="font-size: 12px; color: #9499A0;">秒</span>
                        <div class="enhance-switch" data-feature="skipstart" style="
                            position: relative; width: 40px; height: 22px;
                            border-radius: 11px; background: ${ssOn ? '#fb7299' : '#E3E5E7'};
                            transition: background 0.2s ease; cursor: pointer;
                        ">
                            <div class="enhance-switch-dot" style="
                                position: absolute; top: 2px; left: ${ssOn ? '20px' : '2px'};
                                width: 18px; height: 18px; border-radius: 50%; background: #fff;
                                transition: left 0.2s ease; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                            "></div>
                        </div>
                    </div>
                </div>

                <!-- 4. 结尾跳过 -->
                <div style="border-top: 1px solid #f0f1f3;"></div>
                <div class="enhance-row" data-feature="skipend" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div style="display: flex; align-items: center; gap: 12px; cursor: pointer;" class="enhance-toggle-area" data-feature="skipend">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M14 4L6 10L14 16V4Z" fill="#61666D"/>
                            <rect x="16" y="4" width="2" height="12" rx="1" fill="#61666D"/>
                        </svg>
                        <span style="font-size: 14px; color: #18191C;">结尾跳过</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 0; border-radius: 6px; overflow: hidden; border: 1px solid #e3e5e7;">
                            <button class="enhance-stepper-btn" data-action="dec" data-target="skipend" style="
                                width: 28px; height: 28px; border: none; background: #f1f2f3;
                                cursor: pointer; font-size: 16px; color: #61666D;
                                display: flex; align-items: center; justify-content: center;
                            ">−</button>
                            <input type="text" inputmode="numeric" value="${seSec}" id="enhance-skipend-sec" style="
                                width: 44px; height: 28px; border: none;
                                border-left: 1px solid #e3e5e7; border-right: 1px solid #e3e5e7;
                                text-align: center; font-size: 13px; color: #18191C; background: #fff;
                                outline: none; -moz-appearance: textfield;
                            ">
                            <button class="enhance-stepper-btn" data-action="inc" data-target="skipend" style="
                                width: 28px; height: 28px; border: none; background: #f1f2f3;
                                cursor: pointer; font-size: 16px; color: #61666D;
                                display: flex; align-items: center; justify-content: center;
                            ">+</button>
                        </div>
                        <span style="font-size: 12px; color: #9499A0;">秒</span>
                        <div class="enhance-switch" data-feature="skipend" style="
                            position: relative; width: 40px; height: 22px;
                            border-radius: 11px; background: ${seOn ? '#fb7299' : '#E3E5E7'};
                            transition: background 0.2s ease; cursor: pointer;
                        ">
                            <div class="enhance-switch-dot" style="
                                position: absolute; top: 2px; left: ${seOn ? '20px' : '2px'};
                                width: 18px; height: 18px; border-radius: 50%; background: #fff;
                                transition: left 0.2s ease; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                            "></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // 点击遮罩层关闭
        overlay.addEventListener('click', closeModal);

        // 弹幕跳过行点击（全局配置，存 chrome.storage.sync）
        modal.querySelector('.enhance-row[data-feature="danmaku-skip"]').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFeature('danmaku-skip');
        });

        // 自动连播行点击（页面级，存 sessionStorage）
        modal.querySelector('.enhance-row[data-feature="autoplay"]').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFeature('autoplay');
        });

        // 开头跳过/结尾跳过：点击图标文字区域切换开关
        modal.querySelectorAll('.enhance-toggle-area').forEach(area => {
            area.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFeature(area.dataset.feature);
            });
        });

        // 开关本身也可点击
        modal.querySelectorAll('.enhance-switch').forEach(sw => {
            sw.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFeature(sw.dataset.feature);
            });
        });

        // 步进器按钮（步长1秒）
        modal.querySelectorAll('.enhance-stepper-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                adjustSeconds(btn.dataset.target, btn.dataset.action);
            });
        });

        // 步进器输入框（可直接输入数字）
        const skipStartInput = document.getElementById('enhance-skipstart-sec');
        const skipEndInput = document.getElementById('enhance-skipend-sec');

        let startInputTimer = null;
        skipStartInput.addEventListener('input', () => {
            clearTimeout(startInputTimer);
            startInputTimer = setTimeout(() => {
                const val = parseInt(skipStartInput.value) || 0;
                const clamped = Math.max(0, val);
                setPageState('skipStartSec', clamped);
                applySkipStartSetting(getPageState('skipStart'));
            }, 300);
        });
        skipStartInput.addEventListener('blur', () => {
            let val = parseInt(skipStartInput.value) || 0;
            val = Math.max(0, val);
            skipStartInput.value = val;
            setPageState('skipStartSec', val);
            applySkipStartSetting(getPageState('skipStart'));
        });

        let endInputTimer = null;
        skipEndInput.addEventListener('input', () => {
            clearTimeout(endInputTimer);
            endInputTimer = setTimeout(() => {
                const val = parseInt(skipEndInput.value) || 0;
                const clamped = Math.max(0, val);
                setPageState('skipEndSec', clamped);
                applySkipEndSetting(getPageState('skipEnd'));
            }, 300);
        });
        skipEndInput.addEventListener('blur', () => {
            let val = parseInt(skipEndInput.value) || 0;
            val = Math.max(0, val);
            skipEndInput.value = val;
            setPageState('skipEndSec', val);
            applySkipEndSetting(getPageState('skipEnd'));
        });

        state.modalCreated = true;
    }

    // 更新模态框中某个开关的 UI 状态
    function updateSwitchUI(feature) {
        const sw = document.querySelector(`.enhance-switch[data-feature="${feature}"]`);
        if (!sw) return;
        const dot = sw.querySelector('.enhance-switch-dot');
        let enabled;
        if (feature === 'danmaku-skip') enabled = CONFIG.danmakuSkipEnabled;
        else if (feature === 'autoplay') enabled = getPageState('autoPlay');
        else if (feature === 'skipstart') enabled = getPageState('skipStart');
        else if (feature === 'skipend') enabled = getPageState('skipEnd');
        sw.style.background = enabled ? '#fb7299' : '#E3E5E7';
        if (dot) dot.style.left = enabled ? '20px' : '2px';
    }

    // 更新模态框中秒数输入框的值
    function updateSecondsInput(target) {
        let val;
        if (target === 'skipstart') val = getPageState('skipStartSec');
        else if (target === 'skipend') val = getPageState('skipEndSec');
        const input = document.getElementById(`enhance-${target}-sec`);
        if (input) input.value = val;
    }

    // 调整开头/结尾跳过秒数（步长1秒）
    function adjustSeconds(target, action) {
        let key;
        if (target === 'skipstart') key = 'skipStartSec';
        else if (target === 'skipend') key = 'skipEndSec';
        else return;

        let val = getPageState(key);
        if (action === 'inc') val += 1;
        else val = Math.max(0, val - 1);

        setPageState(key, val);
        updateSecondsInput(target);
        if (target === 'skipstart') applySkipStartSetting(getPageState('skipStart'));
        else if (target === 'skipend') applySkipEndSetting(getPageState('skipEnd'));
    }

    // 切换功能开关
    function toggleFeature(feature) {
        if (feature === 'danmaku-skip') {
            // 全局配置：弹幕跳过
            const newState = !CONFIG.danmakuSkipEnabled;
            CONFIG.danmakuSkipEnabled = newState;
            saveConfig();
            updateSwitchUI('danmaku-skip');
            updateToolbarBadge();
            applyAllSettings();
            if (newState && !state.danmakuProcessed) {
                processDanmakuForVideo();
            }
            console.log('[B站增强] 弹幕自动跳过:', newState ? '开启' : '关闭');
        } else if (feature === 'autoplay') {
            // 页面级：自动连播
            const newState = !getPageState('autoPlay');
            setPageState('autoPlay', newState);
            updateSwitchUI('autoplay');
            updateToolbarBadge();
            applyAutoPlaySetting(newState);
            console.log('[B站增强] 自动连播:', newState ? '开启' : '关闭');
        } else if (feature === 'skipstart') {
            // 页面级：开头跳过
            const newState = !getPageState('skipStart');
            setPageState('skipStart', newState);
            updateSwitchUI('skipstart');
            updateToolbarBadge();
            applySkipStartSetting(newState);
            console.log('[B站增强] 开头跳过:', newState ? '开启' : '关闭');
        } else if (feature === 'skipend') {
            // 页面级：结尾跳过
            const newState = !getPageState('skipEnd');
            setPageState('skipEnd', newState);
            updateSwitchUI('skipend');
            updateToolbarBadge();
            applySkipEndSetting(newState);
            console.log('[B站增强] 结尾跳过:', newState ? '开启' : '关闭');
        }
    }

    // 刷新整个模态框的 UI（打开模态框时调用）
    function refreshModalUI() {
        updateSwitchUI('danmaku-skip');
        updateSwitchUI('autoplay');
        updateSwitchUI('skipstart');
        updateSwitchUI('skipend');
        updateSecondsInput('skipstart');
        updateSecondsInput('skipend');
    }

    // 打开模态框
    function openModal() {
        createModal();
        const overlay = document.getElementById('bili-enhance-overlay');
        const modal = document.getElementById('bili-enhance-modal');
        if (!overlay || !modal) return;

        overlay.style.display = 'block';
        modal.style.display = 'block';

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            modal.style.opacity = '1';
            modal.style.transform = 'translate(-50%, -50%) scale(1)';
        });

        // 打开时刷新所有 UI 状态
        refreshModalUI();
    }

    // 关闭模态框
    function closeModal() {
        const overlay = document.getElementById('bili-enhance-overlay');
        const modal = document.getElementById('bili-enhance-modal');
        if (!overlay || !modal) return;

        overlay.style.opacity = '0';
        modal.style.opacity = '0';
        modal.style.transform = 'translate(-50%, -50%) scale(0.9)';

        setTimeout(() => {
            overlay.style.display = 'none';
            modal.style.display = 'none';
        }, 200);
    }

    // ==================== 检测 video 出现 ====================
    function injectDetectionCSS() {
        const style = document.createElement('style');
        style.textContent = `
            video {
                animation: bili-enhance-video-appear 0.001s !important;
            }
            @keyframes bili-enhance-video-appear {
                from { opacity: 0.99; }
                to { opacity: 1; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function onVideoAppear() {
        applyAllSettings();
        if (!state.danmakuProcessed && CONFIG.danmakuSkipEnabled) {
            processDanmakuForVideo();
        }
    }

    // ==================== 水合检测 ====================
    function waitForHydration() {
        return new Promise((resolve, reject) => {
            const TIMEOUT = 5000;
            const app = document.querySelector('#app');

            // 如果已经没有 data-server-rendered 属性，说明水合已经完成
            if (!app || !app.hasAttribute('data-server-rendered')) {
                resolve();
                return;
            }

            // 用 MutationObserver 监听属性变化
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.attributeName === 'data-server-rendered') {
                        if (!app.hasAttribute('data-server-rendered')) {
                            observer.disconnect();
                            clearTimeout(timeout);
                            // 再等一帧，确保水合完全结束
                            requestAnimationFrame(() => resolve());
                        }
                        break;
                    }
                }
            });

            observer.observe(app, { attributes: true });

            const timeout = setTimeout(() => {
                observer.disconnect();
                reject(new Error('hydration timeout'));
            }, TIMEOUT);
        });
    }

    // ==================== 初始化 ====================
    function init() {
        injectDetectionCSS();

        // animationstart 检测：video 出现
        document.addEventListener('animationstart', (e) => {
            if (e.animationName === 'bili-enhance-video-appear') {
                requestAnimationFrame(() => onVideoAppear());
            }
        }, true);

        // 首次加载：检测 video
        const video = document.querySelector('video');
        if (video) {
            onVideoAppear();
        }

        // 等待水合完成后插入工具栏按钮
        waitForHydration().then(() => {
            if (insertEnhanceButton()) {
                updateToolbarBadge();
                applyAllSettings();
            }
        }).catch(() => {
            console.log('[B站增强] 水合检测超时，跳过按钮插入');
        });

        // 监听URL变化
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function() {
            originalPushState.apply(this, arguments);
            onUrlChange();
        };
        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            onUrlChange();
        };
        window.addEventListener('popstate', onUrlChange);

        function onUrlChange() {
            if (location.href === state.lastUrl) return;
            state.lastUrl = location.href;

            state.buttonInserted = false;
            skipStartDone = false;
            state.danmakuProcessed = false;
            state.skippedSegments.clear();
            state.loadedSegMax = 0;
            state.allDanmakuMatches = [];
            state.isLoadingSegments = false;

            console.log('[B站增强] URL变化');
        }

        state.initialized = true;
        console.log('[B站增强] 扩展已加载');
    }

    // 先加载配置再初始化
    loadConfig().then(() => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    });
})();
