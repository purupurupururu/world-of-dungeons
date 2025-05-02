// ==UserScript==
// @name         WOD AFK Helper
// @version      1.0.0
// @description  1.自动激活最先结束地城的英雄；2.自动加速地城；3.每日访问一次仓库存放战利品
// @author       purupurupururu
// @namespace    https://github.com/purupurupururu
// @match        *://*.world-of-dungeons.org/wod/spiel/settings/heroes.php*
// @match        *://*.world-of-dungeons.org/wod/spiel/rewards/vote.php*
// @icon         http://info.world-of-dungeons.org/wod/css/WOD.gif
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // 解析字符串里的时间
    function parseTime(text) {
        if ((/每日|立刻/).test(text)) return 0;

        const match = text.match(/(今天|明天)?\s(\d{2}):(\d{2})/);
        if (!match) throw new Error(`not support string：${text}`);
        const [_, dayPart, hours, minutes] = match;

        const date = new Date();
        if (dayPart === '明天') {
            date.setDate(date.getDate() + 1);
        }
        date.setHours(hours, minutes);

        return date.getTime();
    }

    function getOffsetCountdown(baseTime, offsetSeconds = 60) {
        return Math.floor((baseTime - Date.now()) / 1000) + offsetSeconds;
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /////////////////////////////////////////////////////////////////////////////////
    class State{

        static STORAGE_KEY = 'WOD_HELPER_STATE';

        static getState() {
            return GM_getValue(this.STORAGE_KEY, {
                lastStoredDate: 0,
                currentHeroIndex: 0,
                checkTime: true,
            });
        }

        static updateState(updater) {
            const newState = {...this.getState(), ...updater};
            GM_setValue(this.STORAGE_KEY, newState);
            return newState;
        }

        static resetState(){
            GM_deleteValue(this.STORAGE_KEY);
        }
    }

    class HeroesPageManager {

        constructor(){
            this.heroRows = null;
            this.nextDungeonDisabledHeroRows = null;
            this.nextDungeonAvailableHeroRows = null;
            this.nextDungeonAvailableHeroDetails = null;
            this.firstCompletedDungeonTime = null;
            this.firstCompletedheroDetails = null;
            this.submitBtn = document.querySelector('input[type="submit"][name="ok"]');
            this.reduceBtn = document.querySelector('input[name="reduce_dungeon_time"]');

            this.init();
        }

        init() {
            if (!this.inHeroListPageContent()) return;
            if (this.handleReduceBtn()) return;
            this.processHeroList();
            this.monitor();
        }

        inHeroListPageContent(){
            if(document.querySelector('input[name=uv_start]')){
                return true;
            }
            return false;
        }

        handleReduceBtn() {
            if(this.reduceBtn?.style.display == '') {
                this.reduceBtn.addEventListener('click', () => {
                    setTimeout(() => {window.location.reload()}, 1000*3);
                    // TODO: 监控AJAX请求，成功请求后刷新页面
                });
                this.reduceBtn.click();
                return true;
            }
            return false;
        }

        calculateTimeRemaining(){
            return getOffsetCountdown(this.firstCompletedDungeonTime);
        }

        processHeroList() {
            this.heroRows = Array.from(
                document.querySelectorAll('table.content_table > tbody > tr:not(.header)')
            );
            this.nextDungeonDisabledHeroRows = Array.from(
                document.querySelectorAll('table.content_table > tbody > tr:not(.header):not(:has(td img))')
            );
            this.nextDungeonAvailableHeroRows = Array.from(
                document.querySelectorAll('table.content_table > tbody > tr:not(.header):has(td img)')
            );
            this.nextDungeonAvailableHeroDetails = this.nextDungeonAvailableHeroRows.map(row => ({
                dom: row,
                time: parseTime(row.lastElementChild.textContent),
                owned: row.querySelector('input[type="submit"]') ? false : true
            }));
            this.firstCompletedDungeonTime = Math.min(
                ...this.nextDungeonAvailableHeroDetails.map(h => h.time)
            );
            this.firstCompletedheroDetails = this.nextDungeonAvailableHeroDetails.filter(
                h => h.time == this.firstCompletedDungeonTime
            );
            console.log('processHeroList: ',{
                heroRows: this.heroRows,
                nextDungeonDisabledHeroRows: this.nextDungeonDisabledHeroRows,
                nextDungeonAvailableHeroRows: this.nextDungeonAvailableHeroRows,
                nextDungeonAvailableHeroDetails: this.nextDungeonAvailableHeroDetails,
                firstCompletedDungeonTime: this.firstCompletedDungeonTime,
                firstCompletedheroDetails: this.firstCompletedheroDetails,
            });
        }

        sendReminder(){
            this.nextDungeonDisabledHeroRows.forEach(row => {
                const newTd = document.createElement('td');
                newTd.className = 'warning';
                newTd.textContent = '未选择地城';
                row.appendChild(newTd);
            });
        }

        activeHeroes(){
            // deselect all checkbox
            this.heroRows.forEach(tr => {
                const checkbox = tr.querySelector('input[type="checkbox"]');
                if(checkbox && checkbox.checked){
                    checkbox.checked = false;
                    console.log('deselect: ', checkbox);
                }
            });

            let lastOwnedHero = null;
            let lastOwnedHeroIndex = -1;
            for (let i = this.firstCompletedheroDetails.length - 1; i >= 0; i--) {
                if (this.firstCompletedheroDetails[i].owned) {
                    lastOwnedHero = this.firstCompletedheroDetails[i];
                    lastOwnedHeroIndex = i;
                    break;
                }
            }
            console.log({
                lastOwnedHero: lastOwnedHero,
                lastOwnedHeroIndex: lastOwnedHeroIndex,
            });

            let lastUvHero = null;
            let lastUvHeroIndex = -1;
            for (let i = this.firstCompletedheroDetails.length - 1; i >= 0; i--) {
                if (!this.firstCompletedheroDetails[i].owned) {
                    lastUvHero = this.firstCompletedheroDetails[i];
                    lastUvHeroIndex = i;
                    break;
                }
            }
            console.log({
                lastUvHero: lastUvHero,
                lastUvHeroIndex: lastUvHeroIndex,
            });

            this.firstCompletedheroDetails.forEach((row, index) => {
                const checkbox = row.dom.querySelector('input[type="checkbox"]');
                const radio = row.dom.querySelector('input[type="radio"][name="FIGUR"]');
                if(lastOwnedHero){
                    if(row.owned && checkbox) {
                        checkbox.checked = true;
                        console.log('seleted: ', checkbox);
                        let checkboxNotActivated = false;
                        if(row.dom.querySelector('.hero_inactive')){
                            checkboxNotActivated = true;
                        }
                        if(lastOwnedHeroIndex == index && !radio.checked || checkboxNotActivated){
                            radio.checked = true;
                            this.submitBtn.click();
                        }
                    }
                }else{
                    if(lastUvHeroIndex == index && !radio.checked){
                        radio.checked = true;
                        this.submitBtn.click();
                    }
                }
            });
        }

        storeLoot(){
            let currentIndex = State.getState().currentHeroIndex;

            if (currentIndex >= this.heroRows.length) {
                console.log('所有英雄处理完毕');
                State.updateState({
                    lastStoredDate: new Date().getDate(),
                    currentHeroIndex: 0,
                });
                this.submitBtn.click();
                console.log(State.getState());
                return;
            }

            const radio = this.heroRows[currentIndex].querySelector('input[type=radio]');
            if(radio && !radio.checked){
                radio.checked = true;
                this.submitBtn.click();
                return;
            }

            if(currentIndex > 0){
                this.heroRows.slice(0, currentIndex).forEach(tr => {
                    const newTd = document.createElement('td');
                    newTd.textContent = '入库完成';
                    tr.appendChild(newTd);
                });
            }

            const newTd = document.createElement('td');
            newTd.textContent = '入库中';
            this.heroRows[currentIndex].appendChild(newTd);

            GM_xmlhttpRequest({
                method: 'GET',
                url: '/wod/spiel/hero/items.php',
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        const buildTextContent = (res) => {
                            // TODO: 正则获取关键字判断手上的战利品是不是满了
                        };
                        State.updateState({currentHeroIndex: ++currentIndex});
                        newTd.textContent = '入库完成';
                        this.storeLoot();
                    } else {
                        console.error(`请求失败，状态码: ${response.status}`);
                    }
                },
                onerror: (error) => {
                    console.error('请求发生错误:', error);
                }
            });
        }

        monitor() {
            // 战利品入库
            const didntStoredToday = () => (new Date().getDate() === State.getState().lastStoredDate);
            const isEnoughTime = () => (1000*60*this.heroRows.length > this.calculateTimeRemaining());
            if(!didntStoredToday() && isEnoughTime()){
                this.storeLoot();
                return;
            }

            // 地城倒计时
            this.sendReminder();
            this.activeHeroes();
            this.startCountdonw();
        }

        startCountdonw(){
            this.firstCompletedheroDetails = this.firstCompletedheroDetails.map(row => ({
                ...row,
                display: document.createElement('td')
            }))
            this.firstCompletedheroDetails.forEach(row => {
                row.dom.appendChild(row.display)
            });

            let timeoutId = null;
            const checkTimeout = () => {
                const countdown = this.calculateTimeRemaining();
                if(countdown > 0){
                    this.firstCompletedheroDetails.forEach(row => {
                        row.display.innerHTML = '⏱️'+ formatTime(countdown);
                    });
                    timeoutId = setTimeout(checkTimeout, 1000);
                }else{
                    clearTimeout(timeoutId);
                    window.location.reload();
                }
            };
            checkTimeout();
        }
    }

    class VotePageManager{
        constructor(){
            this.currentVote = null;
            this.init();
        }

        init(){
            this.processVoteList();
            this.refreshAtMidnight();
            this.monitor();
        }

        extractJsUrls(a){
            const onclickAttr = a?.getAttribute('onclick');
            if(!onclickAttr) return null;
            const match = onclickAttr.match(/js_goto_url\('([^']+)'/);
            return match ? match[1] : null;
        }

        processVoteList(){
            const imgList = Array.from(document.querySelectorAll('div.vote.reward img[title=荣誉]'))
            .map(row =>({
                dom: row,
                url: this.extractJsUrls(row.closest('div.vote.reward').previousElementSibling.querySelector('a')),
                time: parseTime(row.parentElement.textContent)
            }));
            const minItem = imgList.reduce((min, current) => {
                if (!min || current.time < min.time) return current;
                return min;
            }, null);

            this.currentVote = minItem;
        }

        refreshAtMidnight(){
            const midnight = new Date();
            midnight.setHours(24, 0, 0, 0);
            const checkTimeout = () => {
                const remainingtime = getOffsetCountdown(midnight.getTime(), 0);
                remainingtime > 0 ? setTimeout(checkTimeout, 1000) : window.location.reload();
            }
            checkTimeout();
        }

        monitor(){
            const newSpan = document.createElement('span');
            this.currentVote.dom.parentElement.appendChild(newSpan);

            const checkTimeout = () => {
                const remainingtime = getOffsetCountdown(this.currentVote.time);
                if (remainingtime > 0) {
                    setTimeout(checkTimeout, 1000);
                    newSpan.innerHTML = ' ⏱️' + formatTime(remainingtime);
                }else{
                    window.location = this.currentVote.url;
                }
            }
            checkTimeout();
        }
    }

    class WOD{

        static AFK(){
            const path = window.location.pathname;
            const match = path.match(/\/([^\/]+?)\.php$/);
            const pageName = match ? match[1] : '';

            if (typeof pageName !== 'string' || pageName.length === 0) throw new Error('not support current page name');
            const classMap = { HeroesPageManager, VotePageManager };
            const className = pageName[0].toUpperCase() + pageName.slice(1) + 'PageManager';
            const DynamicClass = classMap[className];
            console.log('Route: ',{
                currentPathName: path,
                currentPageName: pageName,
                className: className,
                DynamicClass: DynamicClass
            });
            new DynamicClass();
        }
    }

    WOD.AFK();
})();