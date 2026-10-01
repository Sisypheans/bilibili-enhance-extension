// ==================== 默认配置 ====================
const DEFAULT_CONFIG = {
    maxSkipDuration: 130 * 60,
    minSkipDuration: 5,
    skipMarginStart: 3,
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
let editingRuleIndex = -1;

// ==================== 存储操作 ====================
function loadConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(null, (items) => {
            if (chrome.runtime.lastError) {
                console.warn('读取配置失败，使用默认配置');
                CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            } else {
                CONFIG = { ...DEFAULT_CONFIG, ...items };
                if (!items.matchRules || !Array.isArray(items.matchRules) || items.matchRules.length === 0) {
                    CONFIG.matchRules = JSON.parse(JSON.stringify(DEFAULT_CONFIG.matchRules));
                }
            }
            resolve();
        });
    });
}

function saveConfig() {
    chrome.storage.sync.set(CONFIG, () => {
        if (chrome.runtime.lastError) {
            console.warn('保存配置失败:', chrome.runtime.lastError.message);
        }
    });
}

// ==================== 获取当前活动标签页 ====================
function getActiveTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
                resolve(tabs[0]);
            } else {
                reject(new Error('未找到活动标签页'));
            }
        });
    });
}

// 向当前标签页发送消息
async function sendToActiveTab(message) {
    const tab = await getActiveTab();
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

// 检查当前页面是否是B站视频页
async function isBilibiliVideoPage() {
    try {
        const tab = await getActiveTab();
        const url = tab.url || '';
        return /^https?:\/\/www\.bilibili\.com\/(video|bangumi\/play|list)\//.test(url);
    } catch (e) {
        return false;
    }
}

// ==================== 初始化UI ====================
async function initUI() {
    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });

    // 全局开关绑定（弹幕跳过相关）
    bindGlobalToggle('danmakuSkipEnabled');
    bindGlobalToggle('danmakuSkipNotify');
    bindGlobalToggle('danmakuAutoLike');
    bindGlobalToggle('debug');

    // 页面级开关绑定
    bindPageToggle('autoPlay');
    bindPageToggle('skipStart', (val) => {
        toggleSubSetting('skipStartSetting', val);
    });
    bindPageToggle('skipEnd', (val) => {
        toggleSubSetting('skipEndSetting', val);
    });

    // 步进器（全局参数）
    document.querySelectorAll('.stepper-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const target = btn.dataset.target;
            adjustStepper(target, action);
        });
    });

    // 结尾跳过分秒输入（页面级参数）
    const skipEndMinInput = document.getElementById('skipEndMin');
    const skipEndSecInput = document.getElementById('skipEndSecInput');
    if (skipEndMinInput && skipEndSecInput) {
        let saveTimeout = null;
        const onTimeInput = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                const min = parseInt(skipEndMinInput.value) || 0;
                const sec = parseInt(skipEndSecInput.value) || 0;
                const totalSec = min * 60 + sec;
                sendToActiveTab({ type: 'setSkipEndSec', value: totalSec }).catch(() => {});
            }, 300);
        };
        skipEndMinInput.addEventListener('input', onTimeInput);
        skipEndSecInput.addEventListener('input', onTimeInput);
        skipEndSecInput.addEventListener('blur', () => {
            const min = parseInt(skipEndMinInput.value) || 0;
            let sec = parseInt(skipEndSecInput.value) || 0;
            sec = Math.max(0, sec);
            // 自动换算成标准分+秒格式（例如 180秒 → 分=3, 秒=0）
            const totalSec = min * 60 + sec;
            const newMin = Math.floor(totalSec / 60);
            const newSec = totalSec % 60;
            skipEndMinInput.value = newMin;
            skipEndSecInput.value = newSec;
            sendToActiveTab({ type: 'setSkipEndSec', value: totalSec }).catch(() => {});
        });
    }

    // 开头跳过分秒输入（页面级参数）
    const skipStartMinInput = document.getElementById('skipStartMin');
    const skipStartSecInput = document.getElementById('skipStartSecInput');
    if (skipStartMinInput && skipStartSecInput) {
        let saveTimeout = null;
        const onTimeInput = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                const min = parseInt(skipStartMinInput.value) || 0;
                const sec = parseInt(skipStartSecInput.value) || 0;
                const totalSec = min * 60 + sec;
                sendToActiveTab({ type: 'setSkipStartSec', value: totalSec }).catch(() => {});
            }, 300);
        };
        skipStartMinInput.addEventListener('input', onTimeInput);
        skipStartSecInput.addEventListener('input', onTimeInput);
        skipStartSecInput.addEventListener('blur', () => {
            const min = parseInt(skipStartMinInput.value) || 0;
            let sec = parseInt(skipStartSecInput.value) || 0;
            sec = Math.max(0, sec);
            // 自动换算成标准分+秒格式（例如 180秒 → 分=3, 秒=0）
            const totalSec = min * 60 + sec;
            const newMin = Math.floor(totalSec / 60);
            const newSec = totalSec % 60;
            skipStartMinInput.value = newMin;
            skipStartSecInput.value = newSec;
            sendToActiveTab({ type: 'setSkipStartSec', value: totalSec }).catch(() => {});
        });
    }

    // 规则相关
    document.getElementById('addRuleBtn').addEventListener('click', () => openRuleModal());
    document.getElementById('modalClose').addEventListener('click', closeRuleModal);
    document.getElementById('modalCancel').addEventListener('click', closeRuleModal);
    document.getElementById('modalSave').addEventListener('click', saveRule);

    // 数据管理
    document.getElementById('exportBtn').addEventListener('click', exportConfig);
    document.getElementById('importBtn').addEventListener('click', importConfig);
    document.getElementById('resetBtn').addEventListener('click', resetConfig);

    // 填充数据
    fillUI();
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

// ==================== 开关 ====================
function bindGlobalToggle(key, callback) {
    const input = document.getElementById(key);
    if (!input) return;
    input.addEventListener('change', () => {
        CONFIG[key] = input.checked;
        saveConfig();
        if (callback) callback(input.checked);
    });
}

function bindPageToggle(key, callback) {
    const input = document.getElementById(key);
    if (!input) return;
    input.addEventListener('change', () => {
        const value = input.checked;
        sendToActiveTab({ type: 'setPageState', key, value })
            .then(() => {
                if (callback) callback(value);
            })
            .catch((e) => {
                console.warn('设置页面状态失败:', e.message);
                // 恢复原来的状态
                input.checked = !value;
            });
    });
}

function toggleSubSetting(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('show', show);
}

// ==================== 步进器 ====================
function adjustStepper(target, action) {
    const input = document.getElementById(target);
    if (!input) return;

    let val = parseInt(CONFIG[target]) || 0;
    if (action === 'inc') {
        val += getStepperStep(target);
    } else {
        val = Math.max(0, val - getStepperStep(target));
    }

    CONFIG[target] = val;
    input.value = val;
    saveConfig();
}

function getStepperStep(target) {
    return 1;
}

// ==================== 规则管理 ====================
function renderRules() {
    const list = document.getElementById('rulesList');
    list.innerHTML = '';

    CONFIG.matchRules.forEach((rule, index) => {
        const item = document.createElement('div');
        item.className = 'rule-item';

        const typeLabel = rule.type === 'time_target' ? '时间目标' : '点击次数';
        const dirLabel = { left: '关键词在左', right: '关键词在右', all: '两边均可' }[rule.keyword_direction] || '';

        item.innerHTML = `
            <div class="rule-info">
                <div class="rule-name">${escapeHtml(rule.label)}</div>
                <div class="rule-meta">${typeLabel} · ${dirLabel} · ${rule.keywords.join(', ')}</div>
            </div>
            <div class="rule-actions">
                <button class="rule-action-btn edit" data-index="${index}" title="编辑">✎</button>
                <button class="rule-action-btn delete" data-index="${index}" title="删除">🗑</button>
            </div>
        `;

        item.querySelector('.edit').addEventListener('click', () => openRuleModal(index));
        item.querySelector('.delete').addEventListener('click', () => deleteRule(index));

        list.appendChild(item);
    });
}

function openRuleModal(index = -1) {
    editingRuleIndex = index;
    const modal = document.getElementById('ruleModal');
    const title = document.getElementById('modalTitle');

    if (index >= 0) {
        const rule = CONFIG.matchRules[index];
        title.textContent = '编辑规则';
        document.getElementById('ruleLabel').value = rule.label;
        document.getElementById('ruleKeywords').value = rule.keywords.join(',');
        document.getElementById('ruleType').value = rule.type;
        document.getElementById('ruleDirection').value = rule.keyword_direction;
        document.getElementById('ruleAllowGap').checked = rule.allow_gap;
    } else {
        title.textContent = '添加规则';
        document.getElementById('ruleLabel').value = '';
        document.getElementById('ruleKeywords').value = '';
        document.getElementById('ruleType').value = 'time_target';
        document.getElementById('ruleDirection').value = 'left';
        document.getElementById('ruleAllowGap').checked = false;
    }

    modal.classList.add('show');
}

function closeRuleModal() {
    document.getElementById('ruleModal').classList.remove('show');
    editingRuleIndex = -1;
}

function saveRule() {
    const label = document.getElementById('ruleLabel').value.trim();
    const keywordsStr = document.getElementById('ruleKeywords').value.trim();
    const type = document.getElementById('ruleType').value;
    const direction = document.getElementById('ruleDirection').value;
    const allowGap = document.getElementById('ruleAllowGap').checked;

    if (!label) {
        alert('请输入规则名称');
        return;
    }
    if (!keywordsStr) {
        alert('请输入关键词');
        return;
    }

    const keywords = keywordsStr.split(/[,，]/).map(k => k.trim()).filter(k => k.length > 0);
    if (keywords.length === 0) {
        alert('请输入至少一个关键词');
        return;
    }

    const rule = {
        label,
        keywords,
        type,
        keyword_direction: direction,
        allow_gap: allowGap,
    };

    if (editingRuleIndex >= 0) {
        CONFIG.matchRules[editingRuleIndex] = rule;
    } else {
        CONFIG.matchRules.push(rule);
    }

    saveConfig();
    renderRules();
    closeRuleModal();
}

function deleteRule(index) {
    if (!confirm('确定要删除这个规则吗？')) return;
    CONFIG.matchRules.splice(index, 1);
    saveConfig();
    renderRules();
}

// ==================== 数据导入导出 ====================
function exportConfig() {
    const data = JSON.stringify(CONFIG, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilibili-enhance-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (typeof data !== 'object' || data === null) throw new Error('格式错误');

                CONFIG = { ...DEFAULT_CONFIG, ...data };
                if (!data.matchRules || !Array.isArray(data.matchRules) || data.matchRules.length === 0) {
                    CONFIG.matchRules = JSON.parse(JSON.stringify(DEFAULT_CONFIG.matchRules));
                }

                saveConfig();
                fillUI();
                alert('配置导入成功！');
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

function resetConfig() {
    if (!confirm('确定要恢复默认配置吗？所有自定义设置将丢失。')) return;
    CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    saveConfig();
    fillUI();
}

// ==================== 填充UI ====================
async function fillUI() {
    // 全局开关
    document.getElementById('danmakuSkipEnabled').checked = CONFIG.danmakuSkipEnabled;
    document.getElementById('danmakuSkipNotify').checked = CONFIG.danmakuSkipNotify;
    document.getElementById('danmakuAutoLike').checked = CONFIG.danmakuAutoLike;
    document.getElementById('debug').checked = CONFIG.debug;

    // 页面级开关：从当前标签页获取
    let pageState = { autoPlay: false, skipStart: false, skipEnd: false, skipStartSec: CONFIG.skipStartSec, skipEndSec: CONFIG.skipEndSec };
    try {
        const resp = await sendToActiveTab({ type: 'getPageState' });
        if (resp) {
            pageState.autoPlay = resp.autoPlay;
            pageState.skipStart = resp.skipStart;
            pageState.skipEnd = resp.skipEnd;
            if (resp.skipStartSec !== undefined) pageState.skipStartSec = resp.skipStartSec;
            if (resp.skipEndSec !== undefined) pageState.skipEndSec = resp.skipEndSec;
        }
    } catch (e) {
        // 不是B站页面或content script未加载，默认关闭
        console.log('无法获取页面状态:', e.message);
    }

    document.getElementById('autoPlay').checked = pageState.autoPlay;
    document.getElementById('skipStart').checked = pageState.skipStart;
    document.getElementById('skipEnd').checked = pageState.skipEnd;

    // 子设置显示
    toggleSubSetting('skipStartSetting', pageState.skipStart);
    toggleSubSetting('skipEndSetting', pageState.skipEnd);

    // 开头跳过：分秒输入框（页面级）
    const startMin = Math.floor(pageState.skipStartSec / 60);
    const startSec = pageState.skipStartSec % 60;
    const skipStartMinEl = document.getElementById('skipStartMin');
    const skipStartSecEl = document.getElementById('skipStartSecInput');
    if (skipStartMinEl) skipStartMinEl.value = startMin;
    if (skipStartSecEl) skipStartSecEl.value = startSec;

    // 结尾跳过：分秒输入框（页面级）
    const endMin = Math.floor(pageState.skipEndSec / 60);
    const endSec = pageState.skipEndSec % 60;
    const skipEndMinEl = document.getElementById('skipEndMin');
    const skipEndSecEl = document.getElementById('skipEndSecInput');
    if (skipEndMinEl) skipEndMinEl.value = endMin;
    if (skipEndSecEl) skipEndSecEl.value = endSec;
    document.getElementById('skipMarginStart').value = CONFIG.skipMarginStart;
    document.getElementById('skipMarginEnd').value = CONFIG.skipMarginEnd;
    document.getElementById('minSkipDuration').value = CONFIG.minSkipDuration;
    document.getElementById('maxDanmakuLength').value = CONFIG.maxDanmakuLength;
    document.getElementById('secondsPerRightClick').value = CONFIG.secondsPerRightClick;
    document.getElementById('groupFromTolerance').value = CONFIG.groupFromTolerance;
    document.getElementById('groupToTolerance').value = CONFIG.groupToTolerance;
    document.getElementById('skippedTolerance').value = CONFIG.skippedTolerance;

    // 规则列表
    renderRules();
}

// ==================== 工具函数 ====================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 启动 ====================
loadConfig().then(() => {
    initUI();
});
