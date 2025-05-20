// ==UserScript==
// @name         WOD AFK Helper
// @version      1.0.5
// @description  1.自动激活最先结束地城的英雄；2.自动加速地城；3.每日访问一次仓库存放战利品
// @author       purupurupururu
// @namespace    https://github.com/purupurupururu
// @match        *://*.world-of-dungeons.org/wod/spiel/settings/heroes.php*
// @match        *://*.world-of-dungeons.org/wod/spiel/rewards/vote.php*
// @match        *://*.world-of-dungeons.org/wod/spiel/hero/items.php*
// @icon         https://info.world-of-dungeons.org/wod/css/WOD.gif
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @downloadURL  https://update.greasyfork.org/scripts/534756/WOD%20AFK%20Helper.user.js
// @updateURL    https://update.greasyfork.org/scripts/534756/WOD%20AFK%20Helper.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG_MODE = true;

    function log(...message) {
        if (DEBUG_MODE) {
            console.log('[WOD AFK Helper]', ...message);
        }
    }

    function parseTime(text) {
        if ((/每日|立刻/).test(text)) return Date.now();

        const match = text.match(/(今天|明天)?\s(\d{2}):(\d{2})/);
        if (!match) throw new Error(`not support string：'${text}'`);
        const [_, dayPart, hours, minutes] = match;

        const date = new Date();
        if (dayPart === '明天') {
            date.setDate(date.getDate() + 1);
        }
        date.setHours(hours, minutes, 0, 0);

        return date.getTime();
    }

    function formatTime(microSeconds) {
        const seconds = Math.floor(microSeconds / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    class StateManager {

        static STORAGE_KEY = 'WOD_HELPER_STATE';

        static DEFAULT_STATE = {
            _version: '1.0.5',
            lastStoredDate: 0,
            currentHeroIndex: 0,
            reportCheckTimeout: 0,
            carryingMaxLootHeroes: []
        };

        static get state() {
            const storedData = GM_getValue(this.STORAGE_KEY, {});
            const mergedState = {
                ...this.DEFAULT_STATE,
                ...storedData
            };
            if (mergedState._version !== this.DEFAULT_STATE._version) {
                this.delete();
                return this.DEFAULT_STATE;
            }

            return mergedState;
        }

        static update(value) {
            const newState = {
                ...this.state,
                ...value
            };
            GM_setValue(this.STORAGE_KEY, newState);
        }

        static delete() {
            GM_deleteValue(this.STORAGE_KEY);
        }
    }

    ////////////////////////////////////////////////////////////////////////////////

    class NextDungeon {

        #name;
        #parsedEndTimestamp;

        constructor(td) {
            this.dom = td;
        }

        get name() {
            const regex = /wodToolTip\(.*?,\s*'([^']*)'/;
            return this.dom.getAttribute('onmouseover')?.match(regex)?.[1] || null;
        }

        get parsedEndTimestamp() {
            const timeStr = this.dom.textContent;
            this.#parsedEndTimestamp = parseTime(timeStr);
            return this.#parsedEndTimestamp;
        }

        get countdownDurationMs() {
            return this.parsedEndTimestamp - Date.now();
        }

    }

    class Hero {

        #index;
        #radio;
        #name;
        #class;
        #level;
        #isActive;
        #nextDungeon;
        #storeStatus;
        #checkbox;
        static noDungeonSelectedText = '未选择地城';
        static storingText = '入库中';
        static storedSuccessText = '入库成功';
        static storedFailedText = '手里满了，请及时清理战利品';

        constructor(row, index) {
            this.dom = row;
            this.#index = index;
            this.countdownTd;
            this.repositoryStatusTd;
            this.init();
        }

        init() {
            this.buildTd();
        }

        buildTd() {
            const td = document.createElement('td');
            this.dom.appendChild(td);
        }

        get index() {
            return this.#index;
        }

        get radio() {
            this.#radio = this.dom.querySelector('input[type=radio]');
            return this.#radio;
        }

        get sessionId() {
            const aTag = this.dom.querySelector('td:first-child a');
            return new URL(aTag?.href, window.location.href)
                .searchParams
                .get('session_hero_id');
        }

        get name() {
            this.#name = this.dom.querySelector('td:nth-child(1)').innerText;
            return this.#name;
        }

        get class() {
            this.#class = this.dom.querySelector('td:nth-child(2)').innerText;
            return this.#class;
        }

        get level() {
            this.#level = this.dom.querySelector('td:nth-child(3)').innerText;
            return this.#level;
        }

        get checkbox() {
            const fourthTd = this.dom.querySelector('td:nth-child(4)');
            this.#checkbox = fourthTd?.querySelector('input[type="checkbox"]');
            return this.#checkbox;
        }

        get isOnwershopDirect() {
            const fourthTd = this.dom.querySelector('td:nth-child(4)');
            return fourthTd?.querySelector('input[type="submit"]') ? false : true
        }

        get isActive() {
            if (!this.isOnwershopDirect) return true;
            return this.dom.querySelector('.hero_inactive') ? false : true;
        }

        get nextDungeon() {
            this.#nextDungeon = new NextDungeon(this.dom.querySelector('td:nth-child(5)'));
            return this.#nextDungeon;
        }

        set countdown(value) {
            const countdownTd = this.dom.querySelector('td:nth-child(6)');
            countdownTd.textContent = value;
        }

        set storeStatus(value) {
            const storeStatusTd = this.dom.querySelector('td:nth-child(7)');
            storeStatusTd.textContent = value;
        }

        addToCarryingMaxLootHeroes() {
            StateManager.update({
                carryingMaxLootHeroes: [
                    ...StateManager.state.carryingMaxLootHeroes, {
                        sessionHeroId: this.sessionId,
                        heroTableIndex: this.index
                    }
                ]
            });
        }

        removeFromCarryingMaxLootHeroes() {
            StateManager.update({
                carryingMaxLootHeroes: StateManager.state.carryingMaxLootHeroes.filter(
                    item => item.sessionHeroId !== this.sessionId
                )
            });
        }

        storeLoot(afterSuccessCallback = null) {
            log('Hero.storeLoot()', 'GM_xmlhttpRequest');
            this.storeStatus = Hero.storingText;
            GM_xmlhttpRequest({
                method: 'GET',
                url: '/wod/spiel/hero/items.php',
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        log('Hero.storeLoot()', 'requestSuccess');
                        if (response.responseText.includes(WOD.carryingMaxLootText)) {
                            log('Hero.storeLoot()', 'carryingMaxLootText');
                            this.addToCarryingMaxLootHeroes();
                            this.storeStatus = Hero.storedFailedText;
                        } else {
                            log('Hero.storeLoot()', 'emptyHands');
                            this.removeFromCarryingMaxLootHeroes();
                            this.storeStatus = Hero.storedSuccessText;
                        }
                        const nextHeroIndex = this.index + 1;
                        log('Hero.storeLoot()', 'nextHeroIndex:', nextHeroIndex);
                        StateManager.update({
                            currentHeroIndex: nextHeroIndex
                        });

                        if (afterSuccessCallback) {
                            afterSuccessCallback();
                        }
                    } else {
                        console.error(`请求失败，状态码: ${response.status}`);
                    }
                },
                onerror: (error) => {
                    console.error('请求发生错误:', error);
                }
            });
        }

        selected() {
            if (this.checkbox) {
                this.checkbox.checked = true;
            }
        }

        deselected() {
            if (this.checkbox) {
                this.checkbox.checked = false;
            }
        }

        notifyDungeonSelectionRequired() {
            const fifthTd = this.dom.querySelector('td:nth-child(5)');
            fifthTd.textContent = Hero.noDungeonSelectedText;
        }
    }

    class HeroesPageManager {

        #heroList;
        #reduceBtn;
        #submitBtn;
        static generatingReportText = '正在生成战报';
        static tableHeadCountdown = '倒计时';
        static tableHeadStoringStatus = '入库状态';

        constructor() {
            this.minEndTimestamp;
            this.firstCompletedhero;
            this.init();
        }

        init() {
            if (!this.isHeroListPage()) return;
            this.buildTableHead(HeroesPageManager.tableHeadCountdown);
            this.processHeroList();
            if (this.storeLoot()) return;
            if (this.clickReduceBtn()) return;
            if (!this.activeHero()) return;
            this.displayMsg();
            this.countdown();
        }

        get reduceBtn() {
            this.#reduceBtn = document.querySelector('input[name="reduce_dungeon_time"]');
            return this.#reduceBtn;
        }

        get submitBtn() {
            this.#submitBtn = document.querySelector('form[name=the_form] input[type=submit][name=ok]');
            return this.#submitBtn;
        }

        isHeroListPage() {
            log('HeroesPageManager.isHeroListPage()');
            if (document.querySelector('input[name=uv_start]')) {
                return true;
            }
            return false;
        }

        buildTableHead(name) {
            log('HeroesPageManager.buildTableHead()');
            const headRow = document.querySelector('table.content_table > tbody > tr.header');
            const th = document.createElement('th');
            th.textContent = name;
            headRow.appendChild(th);
        }

        clickReduceBtn() {
            log('HeroesPageManager.clickReduceBtn()');
            this.refreshIfReduce();
            if (this.reduceBtn?.style.display == '') {
                this.reduceBtn.click();
                return true;
            }
            return false;
        }

        refreshIfReduce() {
            const reduce_URL = /\/wod\/ajax\/setPlayerSetting\.php?.+/;

            const originalXHROpen = XMLHttpRequest.prototype.open;
            const originalXHRSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function(method, url) {
                this._xhrId = Math.random().toString(36).substr(2, 9);
                this._requestUrl = url;
                log(`XHR初始化 [${this._xhrId}]`, method, url);
                return originalXHROpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function(body) {
                const xhr = this;
                const url = xhr._requestUrl;

                log(`XHR发送请求 [${xhr._xhrId}]`, url);

                if (reduce_URL.test(url)) {
                    log(`匹配到目标请求 [${xhr._xhrId}]`, url);

                    xhr.addEventListener('readystatechange', function() {
                        log(`状态变化 [${xhr._xhrId}]`, {
                            readyState: xhr.readyState,
                            status: xhr.status,
                            headers: xhr.getAllResponseHeaders()
                        });

                        if (xhr.readyState === 4) {
                            log(`请求完成 [${xhr._xhrId}]`, {
                                status: xhr.status,
                                response: xhr.responseText,
                                headers: xhr.getAllResponseHeaders()
                            });

                            if (xhr.responseText.includes('END_OF_HEADER')) {
                                log(`检测到特殊标记 [${xhr._xhrId}]`);
                                setTimeout(() => {
                                    log(`执行页面刷新 [${xhr._xhrId}]`);
                                    //location.reload();
                                }, 300);
                            }
                        }
                    });

                    xhr.addEventListener('error', function(e) {
                        log(`请求错误 [${xhr._xhrId}]`, e);
                    });

                    xhr.addEventListener('timeout', function(e) {
                        log(`请求超时 [${xhr._xhrId}]`, e);
                    });
                }

                return originalXHRSend.apply(this, arguments);
            };

            window.addEventListener('beforeunload', function() {
                log('页面即将刷新/关闭');
            });
        }

        didStoredTody() {
            return new Date().getDate() === StateManager.state.lastStoredDate;
        }

        isEnoughTimeToStore() {
            return this.calculateTimeRemaining() > 1000 * 60 * this.heroList.length;
        }

        storeLoot() {
            log('HeroesPageManager.storeLoot()');
            if (!this.didStoredTody() && this.isEnoughTimeToStore()) {
                log('HeroesPage.storeLoot', 'didntStoredTody', 'thereIsEnoughTime');
                this.buildTableHead(HeroesPageManager.tableHeadStoringStatus);
                this.heroList.forEach(hero => hero.buildTd());
                this.storeLootProcess();
                return true;
            }
            return false;
        }

        storeLootProcess() {
            let currentIndex = StateManager.state.currentHeroIndex;
            log('HeroesPageManager.storeLootProcess()', `currentIndex: ${currentIndex}`);

            if (currentIndex >= this.heroList.length) {
                log('HeroesPageManager.storeLootProcess()', 'storeLootEnd, reload');
                StateManager.update({
                    lastStoredDate: new Date().getDate(),
                    currentHeroIndex: 0,
                });
                window.location.reload();
                return;
            }

            const currentHero = this.heroList[currentIndex];
            log('HeroesPageManager.storeLootProcess()', `currentHero: ${currentHero}`);
            if (!currentHero.radio.checked) {
                currentHero.radio.checked = true;
                this.submitBtn.click();
                return;
            }

            if (currentIndex > 0) {
                this.heroList.slice(0, currentIndex).forEach((hero, index) => {
                    log({
                        carryingMaxLootHeroes: StateManager.state.carryingMaxLootHeroes,
                        index: index,
                    });

                    let textContent = null;
                    if (StateManager.state.carryingMaxLootHeroes.some(obj => obj.heroTableIndex === index)) {
                        textContent = Hero.storedFailedText;
                    } else {
                        textContent = Hero.storedSuccessText;
                    }
                    hero.storeStatus = textContent;
                });
            }

            currentHero.storeLoot(() => {
                this.storeLootProcess()
            });
        }

        processHeroList() {
            log('HeroesPageManager.processHeroList()');
            this.heroList = Array.from(
                document.querySelectorAll('table.content_table > tbody > tr:not(.header)')
            ).map((row, index) => new Hero(row, index));

            const nextDungeonAvailableHeroList = this.heroList.filter(
                hero => hero.nextDungeon.name !== null
            );
            this.minEndTimestamp = Math.min(
                ...nextDungeonAvailableHeroList.map(hero => hero.nextDungeon.parsedEndTimestamp)
            );

            this.firstCompletedhero = this.heroList.filter(
                hero => hero.nextDungeon.parsedEndTimestamp === this.minEndTimestamp
            );
        }

        beforeSwitchHero() {
            StateManager.update({
                reportCheckTimeout: 0
            });
        }

        activeHero() {
            log('HeroesPageManager.activeHero()');
            this.heroList.forEach(hero => {
                hero.deselected();
            });

            let lastOwnedHero = null;
            let lastOwnedHeroIndex = -1;
            for (let i = this.firstCompletedhero.length - 1; i >= 0; i--) {
                if (this.firstCompletedhero[i].isOnwershopDirect) {
                    lastOwnedHero = this.firstCompletedhero[i];
                    lastOwnedHeroIndex = i;
                    break;
                }
            }
            log('HeroesPageManager.activeHero()', {
                lastOwnedHero: lastOwnedHero,
                lastOwnedHeroIndex: lastOwnedHeroIndex,
            });

            let lastUvHero = null;
            let lastUvHeroIndex = -1;
            for (let i = this.firstCompletedhero.length - 1; i >= 0; i--) {
                if (!this.firstCompletedhero[i].isOnwershopDirect) {
                    lastUvHero = this.firstCompletedhero[i];
                    lastUvHeroIndex = i;
                    break;
                }
            }
            log('HeroesPageManager.activeHero()', {
                lastUvHero: lastUvHero,
                lastUvHeroIndex: lastUvHeroIndex,
            });
            let checkboxNotActivated = false;
            this.firstCompletedhero.forEach((hero, index) => {
                if (lastOwnedHero) {
                    hero.selected();
                    if (!hero.isActive) {
                        checkboxNotActivated = true;
                    }
                    if (lastOwnedHeroIndex == index && !hero.radio.checked || checkboxNotActivated) {
                        hero.radio.checked = true;
                        this.beforeSwitchHero();
                        this.submitBtn.click();
                        return false;
                    }
                } else if (lastUvHeroIndex == index && !hero.radio.checked) {
                    hero.radio.checked = true;
                    this.beforeSwitchHero();
                    this.submitBtn.click();
                    return false;
                }
            });
            return true;
        }

        displayMsg() {
            log('HeroesPageManager.displayMsg()');
            const nextDungeonDisabledHero = this.heroList.filter(hero => hero.nextDungeon.name === null);
            nextDungeonDisabledHero.forEach(hero => {
                hero.notifyDungeonSelectionRequired();
            });

            const carryingMaxLootHeroes = StateManager.state.carryingMaxLootHeroes;
            if (carryingMaxLootHeroes.length !== 0) {
                this.buildTableHead(HeroesPageManager.tableHeadStoringStatus);
                this.heroList.forEach((hero, index) => {
                    hero.buildTd();
                });
                StateManager.state.carryingMaxLootHeroes.forEach(item => {
                    const hero = this.heroList[item.heroTableIndex];
                    hero.storeStatus = Hero.storedFailedText;
                });
            }
        }

        calculateTimeRemaining() {
            return this.minEndTimestamp - Date.now();
        }

        reportCheckTimeoutIncrease(microSeconds) {
            const newTimeout = StateManager.state.reportCheckTimeout + microSeconds;
            StateManager.update({
                reportCheckTimeout: newTimeout
            });
            return StateManager.state.reportCheckTimeout;
        }

        countdown() {
            log('HeroesPageManager.countdown()');
            const checkCountDownTimeout = () => {
                const countdown = this.calculateTimeRemaining();
                if (countdown > 0) {
                    this.firstCompletedhero.forEach(hero => {
                        hero.countdown = `⏱️${formatTime(countdown)}`;
                    });
                    setTimeout(checkCountDownTimeout, 1000);
                } else {
                    const newTimeout = this.reportCheckTimeoutIncrease(5000);
                    let newCountdown = newTimeout;
                    const checkReportTimeout = () => {
                        if (newCountdown > 0) {
                            newCountdown -= 1000;
                            this.firstCompletedhero.forEach(hero => {
                                hero.countdown = `⏱️${formatTime(newCountdown)}${HeroesPageManager.generatingReportText}}`;
                            });
                            setTimeout(checkReportTimeout, 1000);
                        } else {
                            window.location.reload()
                        }
                    };
                    checkReportTimeout();
                }
            }
            checkCountDownTimeout();
        }
    }

    ////////////////////////////////////////////////////////////////////////////////

    class Vote {
        #nextRewardAvailabilityTimestamp;
        #trackedVoteRedirectionUrl;

        constructor(img) {
            this.dom = img;
            this.newSpan;
        }

        get nextRewardAvailabilityTimestamp() {
            if (!this.#nextRewardAvailabilityTimestamp) {
                const text = this.dom.closest('div.vote.reward').textContent;
                this.#nextRewardAvailabilityTimestamp = parseTime(text);
            }
            return this.#nextRewardAvailabilityTimestamp;
        }

        get trackedVoteRedirectionUrl() {
            if (!this.#trackedVoteRedirectionUrl) {
                const a = this.dom.closest('div.vote.reward').previousElementSibling.querySelector('a');
                this.#trackedVoteRedirectionUrl = this.extractJsUrls(a);
            }
            return this.#trackedVoteRedirectionUrl;
        }

        extractJsUrls(a) {
            const onclickAttr = a?.getAttribute('onclick');
            if (!onclickAttr) return null;
            const match = onclickAttr.match(/js_goto_url\('([^']+)'/);
            return match ? match[1] : null;
        }

        show(str) {
            if (!this.newSpan) {
                this.newSpan = document.createElement('span');
                this.newSpan.className = 'info';
                this.dom.parentElement.appendChild(this.newSpan);
            }

            this.newSpan.textContent = str;
        }
    }

    class VotePageManager {

        #voteList;

        constructor() {
            this.minAwardTimeVote;
            this.init();
        }

        init() {
            this.processVoteList();
            this.refreshPageAtNight();
            this.displayCountdown();
        }

        processVoteList() {
            this.#voteList = Array.from(
                document.querySelectorAll('div.vote.reward img')
            ).map(img => new Vote(img));

            const minTimestamp = Math.min(
                ...this.#voteList.map(vote => vote.nextRewardAvailabilityTimestamp)
            );
            log('minTimestamp is: ', minTimestamp);
            const minAwardTimeVote = this.#voteList.filter(vote => {
                log(vote);
                return vote.nextRewardAvailabilityTimestamp === minTimestamp
            });

            log('minAwardTimeVote :', minAwardTimeVote);
            this.minAwardTimeVote = minAwardTimeVote.pop();
            log('this.minAwardTimeVote :', this.minAwardTimeVote);
        }

        refreshPageAtNight() {
            const midnight = new Date();
            midnight.setHours(24, 0, 0, 0);
            const checkTimeout = () => {
                const remainingtime = midnight.getTime() - Date.now();
                remainingtime > 0 ? setTimeout(checkTimeout, 1000) : window.location.reload();
            }
            checkTimeout();
        }

        displayCountdown() {
            const checkTimeout = () => {
                const remainingtime = this.minAwardTimeVote.nextRewardAvailabilityTimestamp - Date.now();
                if (remainingtime > 0) {
                    this.minAwardTimeVote.show(` ⏱️${formatTime(remainingtime)}`);
                    setTimeout(checkTimeout, 1000);
                } else {
                    window.location = this.minAwardTimeVote.trackedVoteRedirectionUrl;
                }
            }
            checkTimeout();
        }
    }

    ////////////////////////////////////////////////////////////////////////////////

    class ItemsPageManager {

        constructor() {
            this.init();
        }

        init() {
            if (!this.hasText(WOD.carryingMaxLootText)) return;

            log('ItemsPageManager.init()', '携带的战利品超出上限');
            const submitBtn = document.querySelectorAll('input[type=submit][name=ok]');
            const markAsEmptyHands = () => {
                const input = document.querySelector('input[type=hidden][name=session_hero_id]');
                const seesionHeroId = input.value;

                const carryingMaxLootHeroes = StateManager.state.carryingMaxLootHeroes;
                const newCarryingMaxLootHeroes = carryingMaxLootHeroes.filter(item => item.sessionHeroId != seesionHeroId);
                StateManager.update({
                    carryingMaxLootHeroes: newCarryingMaxLootHeroes,
                });
            };

            submitBtn.forEach(btn => {
                btn.addEventListener('click', markAsEmptyHands);
            });

        }

        hasText(text) {
            return document.body.textContent.includes(text);
        }
    }

    ////////////////////////////////////////////////////////////////////////////////

    class WOD {

        static carryingMaxLootText = '满了'; // TODO: 替换正确文本

        static get pageName() {
            const path = window.location.pathname;
            const match = path.match(/\/([^\/]+?)\.php$/);
            const pageName = match ? match[1] : '';
            if (typeof pageName !== 'string' || pageName.length === 0) throw new Error('not support current page name');
            return pageName;
        }

        static get classMap() {
            return {
                HeroesPageManager,
                VotePageManager,
                ItemsPageManager,
            };
        }

        static AFK() {
            const className = this.pageName[0].toUpperCase() + this.pageName.slice(1) + 'PageManager';
            const DynamicClass = this.classMap[className];
            log('WOD.AFK()', {
                currentPageName: this.pageName,
                className: className,
                DynamicClass: DynamicClass
            });
            new DynamicClass();
        }
    }

    WOD.AFK();
})();