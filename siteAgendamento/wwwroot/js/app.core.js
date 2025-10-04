// PATH: wwwroot/js/app.core.js
// módulo de entrada (ES module). Orquestra e injeta dependências nos outros módulos.
import { initSidebar } from './app.sidebar.js';
import { initCalendar } from './app.calendar.js';

(function () {
    console.log('APP_CORE_BUILD', '2025-10-06 modules split');

    // ======= auth / bootstrap =======
    const token = localStorage.getItem('soren.token');
    const tenant = localStorage.getItem('soren.tenant_slug');
    const roleRaw = (localStorage.getItem('soren.role') || '');
    const role = roleRaw.toLowerCase();
    const myStaffId = localStorage.getItem('soren.staff_id') || null;
    const isAdmin = role === 'owner' || role === 'admin';
    if (!token || !tenant) { window.location.href = '/login.html'; return; }

    // ======= estado compartilhado =======
    const state = {
        date: new Date(),
        staff: [],
        selectedStaffIds: [],
        appts: [],       // {id,start,end,staffId,...}
        isAdmin,
    };

    // ======= configuração compartilhada =======
    const config = { slotStepMin: 5, defaultDurationMin: 30 };
    const WORK_START = 7 * 60;   // 07:00
    const WORK_END = 20 * 60;  // 20:00

    // ======= elementos globais =======
    const els = {
        dayTitle: document.getElementById('dayTitle'),
        openState: document.getElementById('openState'),
        btnPrev: document.getElementById('btnPrev'),
        btnNext: document.getElementById('btnNext'),
        btnToday: document.getElementById('btnToday'),
        tenantName: document.getElementById('tenantName'),
        userName: document.getElementById('userName'),
        calendar: document.getElementById('calendar'),
        miniCal: document.getElementById('miniCal'),
        staffPanel: document.getElementById('staffPanel'),
        staffList: document.getElementById('staffList'),
        navTeam: document.getElementById('navTeam'),
        teamView: document.getElementById('teamView'),
        settingsView: document.getElementById('settingsView'),
        btnLogout: document.getElementById('btnLogout'),
        fab: document.getElementById('fab'),
        fabMenu: document.getElementById('fabMenu'),
        ctx: document.getElementById('ctxMenu'),
        bookingModal: document.getElementById('bookingModal'),
        bmTitle: document.getElementById('bmTitle'),
        bmStart: document.getElementById('bmStart'),
        bmEnd: document.getElementById('bmEnd'),
        bmSave: document.getElementById('bmSave'),
        bmCancel: document.getElementById('bmCancel'),
        bmClose: document.getElementById('bmClose'),
        topbar: document.querySelector('.topbar'),
        content: document.querySelector('.content'),
    };
    const workspace = document.querySelector('.workspace');

    // ======= util compartilhado =======
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
    const isSameDay = (a, b) => a.toDateString() === b.toDateString();
    function pickColor(i) { const pal = ['#2dc780', '#64b5f6', '#ffb74d', '#ba68c8', '#4db6ac', '#7986cb', '#81c784', '#e57373', '#4dd0e1']; return pal[i % pal.length]; }
    function chosenStaffId() {
        if (state.selectedStaffIds.length === 1) return state.selectedStaffIds[0];
        if (!state.isAdmin && myStaffId) return myStaffId;
        if (state.staff.length) return state.staff[0].id;
        return null;
    }
    function toMinFromDate(d) { return d.getHours() * 60 + d.getMinutes(); }
    function toLabel(min) { const h = String(Math.floor(min / 60)).padStart(2, '0'); const m = String(min % 60).padStart(2, '0'); return `${h}:${m}`; }
    function roundToStep(min) { const step = Math.max(1, Number(config.slotStepMin) || 5); return Math.round(min / step) * step; }
    function withinBusiness(s, e) { return s >= WORK_START && e <= WORK_END; }

    // ======= localStorage placeholders =======
    function dayKey(date) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return `${tenant}::${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function loadLocalPlaceholders(date) {
        const key = `soren.local_appts::${dayKey(date)}`; try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
    }
    function upsertLocalPlaceholder(date, item) {
        const key = `soren.local_appts::${dayKey(date)}`;
        const list = loadLocalPlaceholders(date);
        const ix = list.findIndex(x => x.id === item.id);
        if (ix >= 0) list[ix] = item; else list.push(item);
        localStorage.setItem(key, JSON.stringify(list));
    }
    function removeLocalPlaceholder(date, id) {
        const key = `soren.local_appts::${dayKey(date)}`;
        const list = loadLocalPlaceholders(date).filter(x => x.id !== id);
        localStorage.setItem(key, JSON.stringify(list));
    }

    // ======= API =======
    const apiBase = `${window.location.origin}/api/v1/${encodeURIComponent(tenant)}`;
    async function apiGet(path) {
        const res = await fetch(`${apiBase}${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) {
            let msg = ''; try { msg = (await res.json()).message || ''; } catch { }
            if (!msg) { try { msg = (await res.text()).slice(0, 240); } catch { } }
            throw new Error(`${res.status} ${res.statusText} – ${msg || path}`);
        }
        return res.json();
    }

    // ======= layout: trava scroll do body e dimensiona a grade =======
    function lockBodyScrollAndSize() {
        document.documentElement.style.height = '100%';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.height = '100vh';
        document.body.style.overflow = 'hidden';
        const topbarH = els.topbar ? els.topbar.getBoundingClientRect().height : 0;
        const extra = 24;
        const h = Math.max(320, window.innerHeight - topbarH - extra);
        if (els.calendar) { els.calendar.style.height = `${h}px`; els.calendar.style.overflowY = 'auto'; }
        if (els.content) { els.content.style.height = `calc(100vh - ${Math.round(extra)}px)`; els.content.style.overflow = 'hidden'; }
    }
    window.addEventListener('resize', () => {
        lockBodyScrollAndSize();
        if (isSameDay(state.date, new Date()) && calendarApi?.centerOnNow) calendarApi.centerOnNow(false);
    });

    // ======= branding + settings =======
    function applyBranding(primary, secondary, ink) {
        const root = document.documentElement;
        if (primary) root.style.setProperty('--primary', primary);
        if (secondary) root.style.setProperty('--primary-soft', secondary);
        if (ink) root.style.setProperty('--ink', ink);
    }
    async function loadTenantConfig() {
        try {
            const b = await apiGet(`/branding`);
            const primary = b.primaryColor || b.PrimaryColor || b.primary || b.Primary || '#16a765';
            const secondary = b.secondaryColor || b.SecondaryColor || b.secondary || b.Secondary || '#6dd8a9';
            const ink = b.tertiaryColor || b.TertiaryColor || b.ink || b.Ink || '#0b2f21';
            applyBranding(primary, secondary, ink);
            const slot1 = b.slotGranularityMinutes || b.SlotGranularityMinutes;
            if (slot1) config.slotStepMin = Number(slot1) || config.slotStepMin;
            if (b.companyName && els.tenantName) els.tenantName.textContent = b.companyName;
        } catch { }
        try {
            const s = await apiGet(`/settings`);
            const slot2 = s.slotGranularityMinutes || s.SlotGranularityMinutes || s.slot_step_minutes;
            if (slot2) config.slotStepMin = Number(slot2) || config.slotStepMin;
        } catch { }
    }

    // ======= navegação/topbar básicos (logout + botões dia) =======
    els.tenantName && (els.tenantName.textContent = tenant);
    els.userName && (els.userName.textContent = role ? role[0].toUpperCase() + role.slice(1) : '');

    if (!isAdmin) {  // esconde itens admin
        if (els.navTeam) els.navTeam.hidden = true;
        if (els.staffPanel) els.staffPanel.hidden = true;
        if (myStaffId) state.selectedStaffIds = [myStaffId];
    }

    if (els.btnLogout) {
        els.btnLogout.onclick = () => {
            localStorage.removeItem('soren.token');
            localStorage.removeItem('soren.role');
            localStorage.removeItem('soren.staff_id');
            localStorage.removeItem('soren.tenant_id');
            window.location.href = '/login.html';
        };
    }

    // showView é usado pela sidebar
    function showView(view) {
        if (els.teamView) els.teamView.classList.add('hidden');
        if (els.settingsView) els.settingsView.classList.add('hidden');
        if (workspace) workspace.style.display = 'none';
        if (view === 'agenda') { if (workspace) workspace.style.display = ''; refresh(); }
        else if (view === 'team') { sidebarApi.renderTeamView?.(); if (els.teamView) els.teamView.classList.remove('hidden'); }
        else if (view === 'settings') { if (els.settingsView) els.settingsView.classList.remove('hidden'); }
    }

    if (els.btnPrev) els.btnPrev.onclick = () => { state.date.setDate(state.date.getDate() - 1); sidebarApi.renderMiniCal(state.date); refresh(false); };
    if (els.btnNext) els.btnNext.onclick = () => { state.date.setDate(state.date.getDate() + 1); sidebarApi.renderMiniCal(state.date); refresh(false); };
    if (els.btnToday) els.btnToday.onclick = () => { state.date = new Date(); sidebarApi.renderMiniCal(state.date); refresh(false); };

    // ======= refresh orquestrado =======
    let sidebarApi, calendarApi;
    async function refresh(rebuildMini = true) {
        try {
            if (rebuildMini) sidebarApi.renderMiniCal(state.date);
            if (!state.staff.length) await sidebarApi.loadStaff();
            await calendarApi.loadAppointments();
            calendarApi.renderDay();                // já centraliza em "agora" ao primeiro render
            calendarApi.wireFab?.();
            calendarApi.wireLegacyFabMenu?.();
        } catch (err) {
            console.error(err);
            els.calendar.innerHTML = `
        <div class="calendar-error">
          <div class="calendar-error__title">Ops!</div>
          <div class="calendar-error__msg">${escapeHtml(err.message || 'Falha ao carregar.')}</div>
          <div class="calendar-error__hint">Verifique sua conexão e tente novamente.</div>
        </div>`;
        }
    }

    // ======= expõe o "core" para os módulos =======
    const core = {
        // dados
        token, tenant, role, myStaffId,
        state, config, WORK_START, WORK_END,
        // dom
        els, workspace,
        // utils
        escapeHtml, isSameDay, pickColor, chosenStaffId,
        toMinFromDate, toLabel, roundToStep, withinBusiness,
        loadLocalPlaceholders, upsertLocalPlaceholder, removeLocalPlaceholder,
        // api/layout
        apiGet, lockBodyScrollAndSize, showView,
        // callbacks setadas abaixo
        refresh: () => refresh(true)
    };

    // ======= init =======
    (async function boot() {
        await loadTenantConfig();
        lockBodyScrollAndSize();
        // inicializa módulos e injeta o "core"
        sidebarApi = initSidebar(core);
        calendarApi = initCalendar(core);
        // mini cal inicial + agenda
        sidebarApi.renderMiniCal(state.date);
        await refresh();
    })();
})();
