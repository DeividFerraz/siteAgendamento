// PATH: wwwroot/js/app.js
(function () {
    console.log('APP_JS_BUILD', '2025-10-08 fix tz + azul nos cards + bloqueio sem cliente + availability/day');

    // ======= sessão/estado =======
    const token = localStorage.getItem('soren.token');
    const tenant = localStorage.getItem('soren.tenant_slug');
    const role = (localStorage.getItem('soren.role') || '').toLowerCase();
    const myStaffId = localStorage.getItem('soren.staff_id') || null;

    const isOwner = role === 'owner';
    const isAdmin = role === 'owner' || role === 'admin';
    const canManageCompany = isOwner;

    if (!token || !tenant) { window.location.href = '/login.html'; return; }

    const state = {
        date: new Date(),
        staff: [],
        selectedStaffIds: [],
        appts: [], // {id,start,end,staffId,clientFirstName,clientLastName,client,label,color,kind,...}
        isAdmin,
        availability: { freeRanges: [], userOnline: true },

        tenantSettings: null,
        staffSettingsMap: new Map()
    };

    // ======= grade/ajuda =======
    let gridMetrics = { startMinutes: 0, endMinutes: 24 * 60, pxPerMinute: 80 / 60 };
    const config = { slotStepMin: 5, defaultDurationMin: 30 };

    const business = {
        tz: 'America/Sao_Paulo',
        openMin: 7 * 60,
        closeMin: 20 * 60,
        daysOpen: new Set([1, 2, 3, 4, 5]),
        stepMin: 5,
        defaultAppointmentMin: 30
    };
    const WORK_START = () => business.openMin;
    const WORK_END = () => business.closeMin;

    function roundToStep(min) { const step = Math.max(1, Number(config.slotStepMin) || 5); return Math.round(min / step) * step; }
    function yToMinutes(y) { const m = gridMetrics.startMinutes + (y / gridMetrics.pxPerMinute); return Math.min(gridMetrics.endMinutes, Math.max(gridMetrics.startMinutes, roundToStep(m))); }
    const minutesToTop = (m) => (m - gridMetrics.startMinutes) * gridMetrics.pxPerMinute;
    const minutesToHeight = (a, b) => Math.max(22, (b - a) * gridMetrics.pxPerMinute);

    function withinBusiness(startMin, endMin) {
        const wd = state.date.getDay();
        if (!business.daysOpen.has(wd)) return false;
        return startMin >= WORK_START() && endMin <= WORK_END();
    }
    const toLabel = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const toMinFromDate = (d) => d.getHours() * 60 + d.getMinutes();
    const isSameDay = (a, b) => a.toDateString() === b.toDateString();

    // ======= placeholders locais (por staff) =======
    function ymd(date) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    function dayKey(date, staffId = chosenStaffId()) { return `${tenant}::${staffId || 'none'}::${ymd(date)}`; }
    function loadLocalPlaceholders(date, staffId = chosenStaffId()) { try { return JSON.parse(localStorage.getItem(`soren.local_appts::${dayKey(date, staffId)}`) || '[]'); } catch { return []; } }
    function saveLocalPlaceholders(date, items, staffId = chosenStaffId()) { localStorage.setItem(`soren.local_appts::${dayKey(date, staffId)}`, JSON.stringify(items || [])); }
    function upsertLocalPlaceholder(date, item, staffId = chosenStaffId()) {
        const items = loadLocalPlaceholders(date, staffId);
        const i = items.findIndex(x => x.id === item.id);
        if (i >= 0) items[i] = item; else items.push(item);
        saveLocalPlaceholders(date, items, staffId);
    }
    function removeLocalPlaceholder(date, id, staffId = chosenStaffId()) {
        saveLocalPlaceholders(date, loadLocalPlaceholders(date, staffId).filter(x => x.id !== id), staffId);
    }

    function busyIntervalsForSelectedStaff(excludeId) {
        const chosen = chosenStaffId();
        const ranges = state.appts
            .filter(a =>
                (!chosen || a.staffId === chosen) &&
                (!excludeId || String(a.id) !== String(excludeId))
            )
            .map(a => [toMinFromDate(a.start), toMinFromDate(a.end)])
            .sort((a, b) => a[0] - b[0]);

        const merged = [];
        for (const r of ranges) {
            if (!merged.length || r[0] > merged.at(-1)[1]) merged.push([...r]);
            else merged.at(-1)[1] = Math.max(merged.at(-1)[1], r[1]);
        }
        return merged;
    }

    const collides = (s, e, busy) => busy.some(([a, b]) => !(e <= a || s >= b));
    const formatClientName = (first, last, fallback) => {
        const f = (first || '').trim(), l = (last || '').trim();
        const name = `${f}${f && l ? ' ' : ''}${l}`;
        return name || (fallback || 'Esporádico');
    };

    // ======= opções de tempo p/ modal =======
    function buildTimeOptions(rangePref) {
        const step = Math.max(1, Number(config.slotStepMin) || 5);
        const excludeId = rangePref?.excludeId || null;
        let busy = busyIntervalsForSelectedStaff(excludeId);

        if (state.availability?.freeRanges?.length) {
            const invert = (free) => {
                const start = WORK_START(), end = WORK_END();
                const ranges = []; let cursor = start;
                for (const [s, e] of free.sort((x, y) => x[0] - y[0])) { if (s > cursor) ranges.push([cursor, s]); cursor = Math.max(cursor, e); }
                if (cursor < end) ranges.push([cursor, end]); return ranges;
            };
            busy = invert(state.availability.freeRanges);
        }

        const defaultLen = Math.max(step, Number(business.defaultAppointmentMin || config.defaultDurationMin || step));
        const endsFrom = (startMin) => { const ends = []; for (let t = startMin + step; t <= WORK_END(); t += step) { if (collides(startMin, t, busy)) break; ends.push(t); } return ends; };

        const starts = [];
        for (let t = WORK_START(); t <= WORK_END() - step; t += step) {
            if (collides(t, t + step, busy)) continue;
            const ends = endsFrom(t); if (!ends.length) continue;
            if (ends.some(e => (e - t) >= defaultLen)) starts.push(t);
        }

        let seedStart = rangePref?.startMin ?? (starts[0] ?? WORK_START());
        seedStart = Math.max(WORK_START(), Math.min(seedStart, WORK_END() - step));
        if (!starts.includes(seedStart)) seedStart = starts.find(s => s >= seedStart) ?? starts[0];
        const seedEnds = endsFrom(seedStart); const desiredEnd = seedStart + defaultLen;
        const seedEnd = seedEnds.find(e => e >= desiredEnd) ?? seedEnds.at(-1);
        return { step, busy, starts, endsFrom, seedStart, seedEnd, defaultLen };
    }

    function isRangeAllowed(startMin, endMin, excludeId, mode = 'appt') {
        if (!withinBusiness(startMin, endMin)) return false;

        // Para agendamento normal, precisa estar dentro do "free" calculado
        if (mode === 'appt' && Array.isArray(state.availability?.freeRanges) && state.availability.freeRanges.length) {
            const insideFree = state.availability.freeRanges.some(([s, e]) => startMin >= s && endMin <= e);
            if (!insideFree) return false;
        }

        // Não pode colidir com outros compromissos/bloqueios
        const busy = busyIntervalsForSelectedStaff(excludeId);
        if (collides(startMin, endMin, busy)) return false;

        return true;
    }

    // ======= elementos =======
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

    // ======= layout =======
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
    window.addEventListener('resize', () => { lockBodyScrollAndSize(); if (isSameDay(state.date, new Date())) centerOnNow(false); });

    // ======= API base =======
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
    async function apiSend(method, path, body) {
        const res = await fetch(`${apiBase}${path}`, {
            method,
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
            let msg = ''; try { msg = (await res.json()).message || ''; } catch { }
            if (!msg) { try { msg = (await res.text()).slice(0, 240); } catch { } }
            throw new Error(`${res.status} ${res.statusText} – ${msg || path}`);
        }
        return res.status === 204 ? null : res.json();
    }

    // ======= UI topo =======
    els.tenantName && (els.tenantName.textContent = tenant);
    els.userName && (els.userName.textContent = role ? role[0].toUpperCase() + role.slice(1) : '');

    if (isAdmin) { els.navTeam && (els.navTeam.hidden = false); els.staffPanel && (els.staffPanel.hidden = false); }
    else { els.navTeam && (els.navTeam.hidden = true); els.staffPanel && (els.staffPanel.hidden = true); if (myStaffId) state.selectedStaffIds = [myStaffId]; }

    els.btnPrev && (els.btnPrev.onclick = () => { state.date.setDate(state.date.getDate() - 1); renderMiniCal(state.date); refresh(false); });
    els.btnNext && (els.btnNext.onclick = () => { state.date.setDate(state.date.getDate() + 1); renderMiniCal(state.date); refresh(false); });
    els.btnToday && (els.btnToday.onclick = () => { state.date = new Date(); renderMiniCal(state.date); refresh(false); });

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            if (view === 'agenda') { workspace && (workspace.style.display = ''); refresh(); }
            if (view === 'team') { renderTeamView(); els.teamView && els.teamView.classList.remove('hidden'); workspace && (workspace.style.display = 'none'); }
            if (view === 'settings') { els.settingsView && els.settingsView.classList.remove('hidden'); workspace && (workspace.style.display = 'none'); }
            if (view !== 'team') { els.teamView && els.teamView.classList.add('hidden'); }
            if (view !== 'settings') { els.settingsView && els.settingsView.classList.add('hidden'); }
        });
    });

    els.btnLogout && (els.btnLogout.onclick = () => {
        localStorage.removeItem('soren.token'); localStorage.removeItem('soren.role');
        localStorage.removeItem('soren.staff_id'); localStorage.removeItem('soren.tenant_id');
        window.location.href = '/login.html';
    });

    // ======= Mini calendário =======
    function renderMiniCal(date) {
        if (!els.miniCal) return;
        const y = date.getFullYear(); const m = date.getMonth();
        const first = new Date(y, m, 1); const start = new Date(first);
        start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
        const title = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        let html = `
      <div class="cal-head">
        <button id="calPrev">‹</button>
        <strong>${title[0].toUpperCase() + title.slice(1)}</strong>
        <button id="calNext">›</button>
      </div>
      <div class="grid">
        ${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(d => `<div class="dow">${d}</div>`).join('')}
    `;
        const todayKey = new Date().toDateString();
        for (let i = 0; i < 42; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const other = d.getMonth() !== m ? 'other' : ''; const today = d.toDateString() === todayKey ? 'today' : '';
            const sel = d.toDateString() === state.date.toDateString() ? 'sel' : '';
            html += `<div class="day ${other} ${today} ${sel}" data-date="${d.toISOString()}">${d.getDate()}</div>`;
        }
        html += `</div>`;
        els.miniCal.innerHTML = html;
        document.getElementById('calPrev').onclick = () => { state.date = new Date(y, m - 1, state.date.getDate()); renderMiniCal(state.date); refresh(false); };
        document.getElementById('calNext').onclick = () => { state.date = new Date(y, m + 1, state.date.getDate()); renderMiniCal(state.date); refresh(false); };
        els.miniCal.querySelectorAll('.day').forEach(d => d.addEventListener('click', () => { state.date = new Date(d.dataset.date); renderMiniCal(state.date); refresh(false); }));
    }

    // ======= Staff =======
    async function loadStaff() {
        try {
            const res = await apiGet(`/staff?active=true`);
            state.staff = (res.items || res || []).map((s, i) => ({
                id: s.id || s.Id || s.staffId || s.StaffId,
                name: s.displayName || s.DisplayName || s.name || s.Name,
                color: pickColor(i)
            }));
        } catch {
            state.staff = myStaffId ? [{ id: myStaffId, name: 'Minha agenda', color: pickColor(0) }] : [];
        }
        if (isAdmin) state.selectedStaffIds = [];
        renderStaffChips();
    }

    function renderStaffChips() {
        if (!isAdmin || !els.staffList) return;
        els.staffList.innerHTML = '';
        const allActive = state.selectedStaffIds.length === 0;
        const chipAll = createChip('Todos', allActive);
        chipAll.onclick = () => { state.selectedStaffIds = []; refresh(); syncChips(); };
        els.staffList.appendChild(chipAll);

        state.staff.forEach(s => {
            const active = state.selectedStaffIds.length === 0 || state.selectedStaffIds.includes(s.id);
            const chip = createChip(s.name, active, s.color);
            chip.onclick = () => {
                if (state.selectedStaffIds.length === 0) state.selectedStaffIds = [s.id];
                else {
                    const idx = state.selectedStaffIds.indexOf(s.id);
                    if (idx >= 0) state.selectedStaffIds.splice(idx, 1); else state.selectedStaffIds.push(s.id);
                    if (state.selectedStaffIds.length === 0) state.selectedStaffIds = [s.id];
                }
                refresh(); syncChips();
            };
            chip.dataset.staffId = s.id;
            els.staffList.appendChild(chip);
        });

        function syncChips() {
            els.staffList.querySelectorAll('.staff-chip').forEach(ch => ch.classList.remove('active'));
            if (state.selectedStaffIds.length === 0) chipAll.classList.add('active');
            else els.staffList.querySelectorAll('.staff-chip').forEach(ch => ch.dataset.staffId && state.selectedStaffIds.includes(ch.dataset.staffId) && ch.classList.add('active'));
        }

        function createChip(text, active, color) {
            const el = document.createElement('button');
            el.className = 'staff-chip' + (active ? ' active' : '');
            el.textContent = text;
            if (color) el.style.boxShadow = `inset 0 0 0 2px ${color}33`;
            return el;
        }
    }

    // ======= Agendamentos =======
    async function loadAppointments() {
        const d = new Date(state.date.getFullYear(), state.date.getMonth(), state.date.getDate());
        const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0));
        const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
        const startIsoUtc = start.toISOString(), endIsoUtc = end.toISOString();
        const staffParam = state.selectedStaffIds.length === 1 ? `&staffId=${encodeURIComponent(state.selectedStaffIds[0])}` : '';

        let fromBackend = [];
        try {
            const data = await apiGet(`/appointments?fromUtc=${encodeURIComponent(startIsoUtc)}&toUtc=${encodeURIComponent(endIsoUtc)}${staffParam}`);
            fromBackend = normalizeAppts(data);
        } catch (_) {
            try {
                const dateParam = ymd(d);
                const data = await apiGet(`/appointments/day?date=${dateParam}${staffParam}`); fromBackend = normalizeAppts(data);
            } catch {
                try {
                    const data = await apiGet(`/appointments/range?fromUtc=${encodeURIComponent(startIsoUtc)}&toUtc=${encodeURIComponent(endIsoUtc)}${staffParam}`); fromBackend = normalizeAppts(data);
                } catch {
                    const data = await apiGet(`/appointments?from=${encodeURIComponent(startIsoUtc)}&to=${encodeURIComponent(endIsoUtc)}${staffParam}`); fromBackend = normalizeAppts(data);
                }
            }
        }

        state.appts = fromBackend;
    }

    function normalizeAppts(raw) {
        const list = raw.items || raw || [];
        return list.map((a, i) => {
            const start = new Date(a.startUtc || a.StartUtc || a.start || a.Start);
            const end = new Date(a.endUtc || a.EndUtc || a.end || a.End);
            const staffId = a.staffId || a.StaffId || myStaffId || null;
            const staff = state.staff.find(s => s.id === staffId);

            // tente extrair guest (pode vir como objeto ou como json string)
            let guest = a.guest || a.Guest;
            const guestJson = a.guestContactJson || a.GuestContactJson;
            if (!guest && typeof guestJson === 'string') { try { guest = JSON.parse(guestJson); } catch { } }

            const first = guest?.firstName || guest?.FirstName || a.client?.firstName || a.ClientFirstName || '';
            const last = guest?.lastName || guest?.LastName || a.client?.lastName || a.ClientLastName || '';
            const displayClient = a.clientName || a.ClientName || formatClientName(first, last, '');

            // cores: azul p/ agendamento ; cinza p/ bloqueio/folga
            const isAppt = (a.kind || a.Kind || '').toString().toLowerCase() === 'appt';
            const color = isAppt ? '#2196f3' : '#90a4ae';

            return {
                id: a.id || a.Id || `appt-${i}`,
                start, end,
                staffId,
                staffName: staff ? staff.name : (a.staffName || a.StaffName || ''),
                clientFirstName: first || '',
                clientLastName: last || '',
                client: displayClient || 'Esporádico',
                service: a.serviceName || a.ServiceName || '',
                color,
                kind: (a.kind || a.Kind || undefined),
                pending: !!(a.pending || a.Pending),
                locked: !!(a.locked || a.Kind === 'block' || a.Kind === 'timeoff')
            };
        });
    }

    // ======= Availability =======
    async function loadAvailability() {
        const d = new Date(state.date.getFullYear(), state.date.getMonth(), state.date.getDate());
        const staffId = chosenStaffId();
        if (!staffId) { state.availability = { freeRanges: [], userOnline: false }; return; }

        try {
            const isoDate = ymd(d);
            const res = await apiGet(`/availability/day?staffId=${encodeURIComponent(staffId)}&date=${encodeURIComponent(isoDate)}`);
            const toMin = (iso) => { const x = new Date(iso); return x.getHours() * 60 + x.getMinutes(); };
            const freeRanges = Array.isArray(res.free) ? res.free.map(([a, b]) => [toMin(a), toMin(b)]) : [];
            state.availability = { freeRanges, userOnline: !!res.userOnline };
        } catch (e) {
            console.warn('loadAvailability()', e);
            state.availability = { freeRanges: [], userOnline: true };
        }
    }

    // ======= Render dia =======
    function renderDay() {
        if (!els.calendar) return;
        lockBodyScrollAndSize();

        const fmt = state.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replaceAll('.', '');
        els.dayTitle && (els.dayTitle.textContent = fmt);
        els.openState && (els.openState.textContent = '');

        const chipDate = document.getElementById('chipDate');
        const chipOpenState = document.getElementById('chipOpenState');
        chipDate && (chipDate.textContent = fmt);

        const wd = state.date.getDay();
        const isOpen = business.daysOpen.has(wd);
        const openText = isOpen ? (state.availability.userOnline ? 'Aberto (online)' : 'Aberto') : 'Fechado';
        chipOpenState && (chipOpenState.textContent = openText);
        els.openState && (els.openState.textContent = openText);

        const hoursCol = document.createElement('div');
        hoursCol.className = 'hours';
        for (let h = 0; h <= 23; h++) { const div = document.createElement('div'); div.className = 'h'; div.textContent = `${String(h).padStart(2, '0')}:00`; hoursCol.appendChild(div); }

        const grid = document.createElement('div'); grid.className = 'grid';
        gridMetrics = { startMinutes: 0, endMinutes: 24 * 60, pxPerMinute: 80 / 60 };

        const dayBody = document.createElement('div'); dayBody.style.height = `${minutesToHeight(0, 24 * 60)}px`; dayBody.style.pointerEvents = 'none'; grid.appendChild(dayBody);

        const ohTop = document.createElement('div'); ohTop.className = 'offhours'; ohTop.style.top = `${minutesToTop(0)}px`; ohTop.style.height = `${minutesToHeight(0, WORK_START())}px`; grid.appendChild(ohTop);
        const ohBottom = document.createElement('div'); ohBottom.className = 'offhours'; ohBottom.style.top = `${minutesToTop(WORK_END())}px`; ohBottom.style.height = `${minutesToHeight(WORK_END(), 24 * 60)}px`; grid.appendChild(ohBottom);

        const now = new Date();
        if (isSameDay(now, state.date)) {
            const nowM = now.getHours() * 60 + now.getMinutes();
            const nowLine = document.createElement('div'); nowLine.className = 'nowline'; nowLine.style.top = `${Math.max(0, minutesToTop(nowM))}px`; grid.appendChild(nowLine);
        }

        state.appts.forEach(a => {
            const sM = a.start.getHours() * 60 + a.start.getMinutes();
            const eM = a.end.getHours() * 60 + a.end.getMinutes();
            const card = document.createElement('div'); card.className = 'appt';
            a.locked && card.classList.add('locked'); a.pending && card.classList.add('pending');
            card.style.top = `${minutesToTop(sM)}px`; card.style.height = `${minutesToHeight(sM, eM)}px`;

            // Azul para agendamento, cinza para bloqueio/folga
            const isAppt = (a.kind || '').toString().toLowerCase() === 'appt';
            const border = isAppt ? '#2196f3' : '#90a4ae';
            const bg = isAppt ? '#e3f2fd' : '#eceff1';
            card.style.borderColor = border;
            card.style.backgroundColor = bg;
            card.style.borderStyle = a.kind === 'block' ? 'dashed' : 'solid';

            // >>>>> layout responsivo
            const heightPx = minutesToHeight(sM, eM);
            const compact = heightPx < 52;
            const timeHtml = `${a.start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ${a.end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
            const clientLabel = formatClientName(a.clientFirstName, a.clientLastName, a.client);

            if (compact) {
                card.innerHTML = `
                  <div class="row" style="display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden;">
                    <div class="t" style="flex:0 0 auto;">${timeHtml}</div>
                    <div class="c" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(clientLabel)}</div>
                  </div>
                  <div class="f" style="display:none;"></div>`;
            } else {
                card.innerHTML = `
                  <div class="t">${timeHtml}</div>
                  <div class="c" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(clientLabel)}</div>
                  <div class="f" style="min-height:6px;"></div>`;
            }
            // <<<<<

            card.dataset.apptId = String(a.id || `appt-${sM}-${eM}`); card.dataset.startMin = String(sM); card.dataset.endMin = String(eM);
            if (!a.locked) { const hTop = document.createElement('div'); hTop.className = 'handle top'; const hBot = document.createElement('div'); hBot.className = 'handle bot'; card.appendChild(hTop); card.appendChild(hBot); }
            grid.appendChild(card);
        });

        els.calendar.innerHTML = ''; els.calendar.appendChild(hoursCol); els.calendar.appendChild(grid);
        hoursCol.addEventListener('wheel', (ev) => { els.calendar.scrollTop += (ev.deltaY || ev.wheelDelta || 0); ev.preventDefault(); }, { passive: false });
        wireGridInteractions(grid);
        centerOnNow(true);
    }

    function centerOnNow(firstRender) {
        if (!els.calendar) return;
        const now = new Date();
        const targetMin = isSameDay(now, state.date) ? (now.getHours() * 60 + now.getMinutes()) : WORK_START();
        const offset = Math.max(0, minutesToTop(targetMin) - (els.calendar.clientHeight * 0.33));
        els.calendar.scrollTo({ top: offset, behavior: firstRender ? 'auto' : 'smooth' });
    }

    // ======= Team view =======
    async function renderTeamView() {
        if (!isAdmin) return;
        if (!state.staff.length) await loadStaff();
        const el = document.getElementById('teamTable'); if (!el) return;
        el.innerHTML = state.staff.map(s => `<div class="staff-row"><strong style="color:${s.color}">${escapeHtml(s.name)}</strong> · ID: ${s.id}</div>`).join('') || '<div class="muted">Sem colaboradores cadastrados.</div>';
    }

    // ======= util =======
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    const pickColor = (i) => (['#2dc780', '#64b5f6', '#ffb74d', '#ba68c8', '#4db6ac', '#7986cb', '#81c784', '#e57373', '#4dd0e1'])[i % 9];
    function chosenStaffId() {
        if (state.selectedStaffIds.length === 1) return state.selectedStaffIds[0];
        if (!canManageCompany && myStaffId) return myStaffId;
        if (state.staff.length) return state.staff[0].id;
        return null;
    }
    function getApptById(id) { return state.appts.find(a => String(a.id) === String(id)) || null; }
    function hhmmToMin(hhmm) { const [h, m] = String(hhmm || '').split(':').map(Number); return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m || 0 : 0); }
    function normalizeDays(days) {
        if (!Array.isArray(days)) return new Set([1, 2, 3, 4, 5]);
        const map = { 'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'dom': 0, 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sáb': 6, 'sab': 6 };
        const out = new Set(); for (const d of days) { if (typeof d === 'number' && d >= 0 && d <= 6) { out.add(d); continue; } const k = String(d || '').trim().toLowerCase(); if (k in map) out.add(map[k]); }
        return out.size ? out : new Set([1, 2, 3, 4, 5]);
    }

    // ======= SETTINGS efetivos =======
    async function ensureEffectiveSettings() {
        if (!state.tenantSettings) { state.tenantSettings = await apiGet(`/settings`); }

        const staffId = chosenStaffId();
        let staffSettings = null;

        const shouldUseStaff = !canManageCompany || (canManageCompany && state.selectedStaffIds.length === 1);
        if (shouldUseStaff && staffId) {
            if (!state.staffSettingsMap.has(staffId)) {
                try { state.staffSettingsMap.set(staffId, await apiGet(`/staff/${encodeURIComponent(staffId)}/settings`) || {}); }
                catch { state.staffSettingsMap.set(staffId, {}); }
            }
            staffSettings = state.staffSettingsMap.get(staffId);
        }

        const eff = buildEffectiveConfig(state.tenantSettings, staffSettings);
        business.tz = eff.timezone || business.tz;
        business.openMin = hhmmToMin(eff.openTime || '07:00');
        business.closeMin = hhmmToMin(eff.closeTime || '20:00');
        business.daysOpen = normalizeDays(eff.businessDays || []);
        business.stepMin = Number(eff.slotGranularityMinutes || 5);
        business.defaultAppointmentMin = Number(eff.defaultAppointmentMinutes || 60);

        config.slotStepMin = business.stepMin;
        config.defaultDurationMin = business.defaultAppointmentMin;

        await loadBrandingOnce();
    }

    function buildEffectiveConfig(company, staff) {
        const c = company || {}; const s = staff || {};
        return {
            timezone: s.timezone || c.timezone,
            openTime: s.openTime || c.openTime,
            closeTime: s.closeTime || c.closeTime,
            businessDays: s.businessDays || c.businessDays,
            slotGranularityMinutes: s.slotGranularityMinutes || c.slotGranularityMinutes,
            defaultAppointmentMinutes: s.defaultAppointmentMinutes || c.defaultAppointmentMinutes,
            companyName: c.companyName
        };
    }

    // Branding
    let brandingLoaded = false;
    async function loadBrandingOnce() {
        if (brandingLoaded) return;
        try {
            const b = await apiGet(`/branding`);
            const primary = b.primaryColor || b.Primary || b.primary || '#16a765';
            const secondary = b.secondaryColor || b.Secondary || b.secondary || '#6dd8a9';
            const ink = b.tertiaryColor || b.Tertiary || b.ink || '#0b2f21';
            const root = document.documentElement; root.style.setProperty('--primary', primary); root.style.setProperty('--primary-soft', secondary); root.style.setProperty('--ink', ink);
            if ((b.companyName || state.tenantSettings?.companyName) && els.tenantName) els.tenantName.textContent = b.companyName || state.tenantSettings?.companyName;
        } catch { }
        brandingLoaded = true;
    }

    // ======= interações / drag =======
    let drag = null, suppressClickAfterDrag = false; const DRAG_THRESHOLD_PX = 3;
    function gridY(ev, scroller, grid) { const r = grid.getBoundingClientRect(); return (ev.clientY - r.top) + scroller.scrollTop; }
    function updateApptInStateAndLocal(id, startMin, endMin) {
        const d = state.date;
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); s.setMinutes(startMin);
        const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); e.setMinutes(endMin);
        const item = state.appts.find(a => String(a.id) === String(id)); if (item) { item.start = s; item.end = e; }
        if (String(id).startsWith('temp-')) {
            const staffId = chosenStaffId();
            const local = loadLocalPlaceholders(state.date, staffId);
            const li = local.find(x => x.id === id); if (li) { li.start = s.toISOString(); li.end = e.toISOString(); upsertLocalPlaceholder(state.date, li, staffId); }
        }
    }

    function wireGridInteractions(grid) {
        const scroller = els.calendar;

        // criar seleção
        grid.addEventListener('mousedown', (e) => {
            if (e.target.closest('.appt')) return;
            const y0 = gridY(e, scroller, grid);
            drag = { mode: 'create', startY: y0 };
            const startM = yToMinutes(y0); drag.startMin = startM; drag.endMin = startM + config.defaultDurationMin;
            const ghost = document.createElement('div'); ghost.className = 'select-ghost';
            ghost.style.top = `${minutesToTop(Math.min(drag.startMin, drag.endMin))}px`;
            ghost.style.height = `${minutesToHeight(Math.min(drag.startMin, drag.endMin), Math.max(drag.startMin, drag.endMin))}px`;
            grid.appendChild(ghost); drag.ghost = ghost;

            const onMove = (ev) => {
                const y = Math.max(0, Math.min(scroller.scrollHeight, gridY(ev, scroller, grid)));
                const m = yToMinutes(y); drag.endMin = Math.max(m, drag.startMin + Math.max(1, Number(config.slotStepMin) || 5));
                ghost.style.top = `${minutesToTop(Math.min(drag.startMin, drag.endMin))}px`;
                ghost.style.height = `${minutesToHeight(Math.min(drag.startMin, drag.endMin), Math.max(drag.startMin, drag.endMin))}px`;
            };
            const onUp = (ev) => {
                grid.removeEventListener('mousemove', onMove); grid.removeEventListener('mouseup', onUp); ghost.parentNode && ghost.parentNode.removeChild(ghost);
                const range = { startMin: Math.min(drag.startMin, drag.endMin), endMin: Math.max(drag.startMin, drag.endMin) }; drag = null;
                if (!withinBusiness(range.startMin, range.endMin)) return;
                openActionMenu(ev.clientX, ev.clientY, range);
            };
            grid.addEventListener('mousemove', onMove); grid.addEventListener('mouseup', onUp);
        });

        // mover/resize
        grid.addEventListener('mousedown', (e) => {
            const card = e.target.closest('.appt'); if (!card || card.classList.contains('locked')) return;
            const sM0 = Number(card.dataset.startMin), eM0 = Number(card.dataset.endMin);
            const step = Math.max(1, Number(config.slotStepMin) || 5);
            const startScrollTop = scroller.scrollTop, startClientY = e.clientY; let didDrag = false;

            if (e.target.classList.contains('handle')) drag = { mode: e.target.classList.contains('top') ? 'resize-top' : 'resize-bot', apptEl: card, startMin: sM0, endMin: eM0, startY: e.clientY, startScrollTop };
            else drag = { mode: 'move', apptEl: card, startMin: sM0, endMin: eM0, startY: e.clientY, startScrollTop };
            card.classList.add('dragging');

            const onMove = (ev) => {
                const moveAbs = Math.abs(ev.clientY - startClientY); if (moveAbs > DRAG_THRESHOLD_PX) didDrag = true;
                const dy = (ev.clientY - drag.startY) + (scroller.scrollTop - drag.startScrollTop);
                const deltaMin = roundToStep(dy / gridMetrics.pxPerMinute);
                if (drag.mode === 'move') { let ns = sM0 + deltaMin, ne = eM0 + deltaMin; const len = ne - ns; ns = Math.max(gridMetrics.startMinutes, Math.min(ns, gridMetrics.endMinutes - len)); ne = ns + len; applyGhost(card, ns, ne); }
                else if (drag.mode === 'resize-top') { let ns = Math.min(eM0 - step, sM0 + deltaMin); ns = Math.max(gridMetrics.startMinutes, ns); applyGhost(card, ns, eM0); }
                else { let ne = Math.max(sM0 + step, eM0 + deltaMin); ne = Math.min(gridMetrics.endMinutes, ne); applyGhost(card, sM0, ne); }
                const ns = Number(card.dataset.startMin), ne = Number(card.dataset.endMin); if (!withinBusiness(ns, ne)) card.classList.add('invalid'); else card.classList.remove('invalid');
            };
            const onUp = async () => {
                grid.removeEventListener('mousemove', onMove);
                grid.removeEventListener('mouseup', onUp);
                card.classList.remove('dragging');

                const id = card.dataset.apptId || null;
                const ns = Number(card.dataset.startMin), ne = Number(card.dataset.endMin);

                if (!withinBusiness(ns, ne)) {
                    applyGhost(card, sM0, eM0);
                    card.classList.remove('invalid');
                    suppressClickAfterDrag = didDrag;
                    drag = null;
                    return;
                }

                if (didDrag && (ns !== sM0 || ne !== eM0)) {
                    try {
                        await apiUpdateAppointment(id, ns, ne);
                        await refresh(false);
                        suppressClickAfterDrag = true;
                    } catch (e) {
                        // volta visualmente ao estado anterior caso a API rejeite (ex.: conflito)
                        applyGhost(card, sM0, eM0);
                        card.classList.add('invalid');
                        setTimeout(() => card.classList.remove('invalid'), 900);
                        alert((e && e.message) ? `Não foi possível mover/redimensionar: ${e.message}` : 'Erro ao salvar.');
                        suppressClickAfterDrag = true;
                    } finally {
                        drag = null;
                    }
                    return;
                }

                suppressClickAfterDrag = false;
                drag = null;
            };
            grid.addEventListener('mousemove', onMove); grid.addEventListener('mouseup', onUp);
        });

        grid.addEventListener('click', (e) => {
            if (suppressClickAfterDrag) { suppressClickAfterDrag = false; return; }
            const card = e.target.closest('.appt'); if (!card) return; if (e.target.classList?.contains('handle')) return;
            e.stopPropagation(); const id = card.dataset.apptId; const appt = getApptById(id); if (!appt) return; openApptMenu(e.clientX, e.clientY, appt);
        });
    }

    // ======= menus / modal =======
    function openActionMenu(x, y, range) {
        const menu = els.ctx; if (!menu) return;
        menu.innerHTML = `<button data-act="new">Novo agendamento</button><button data-act="block">Bloqueio de horário</button><button data-act="timeoff">Adicionar folga</button>`;
        menu.style.left = `${x}px`; menu.style.top = `${y}px`; menu.classList.remove('hidden');
        menu.querySelectorAll('button').forEach(btn => btn.onclick = () => { menu.classList.add('hidden'); const act = btn.dataset.act; if (act === 'new') openBookingDialog('appt', range); else if (act === 'block') openBookingDialog('block', range); else openBookingDialog('timeoff', range); });
        window.addEventListener('click', (ev) => { if (!ev.target.closest('#ctxMenu')) menu.classList.add('hidden'); }, { once: true });
    }
    function openApptMenu(x, y, appt) {
        const menu = els.ctx; if (!menu) return;
        menu.innerHTML = `<button data-act="edit">Editar horário</button><button data-act="del">Excluir</button>`;
        menu.style.left = `${x}px`; menu.style.top = `${y}px`; menu.classList.remove('hidden');
        menu.querySelector('[data-act="edit"]').onclick = () => {
            menu.classList.add('hidden');
            const startMin = toMinFromDate(appt.start), endMin = toMinFromDate(appt.end);
            openBookingDialog(appt.kind || 'appt', { startMin, endMin, excludeId: String(appt.id) }, { id: String(appt.id) });
        };
        menu.querySelector('[data-act="del"]').onclick = () => {
            menu.classList.add('hidden'); const id = String(appt.id);
            if (id.startsWith('temp-')) { state.appts = state.appts.filter(a => String(a.id) !== id); removeLocalPlaceholder(state.date, id); renderDay(); }
            else if (confirm('Cancelar este agendamento?')) { apiDeleteAppointment(id).finally(() => refresh(false)); }
        };
        window.addEventListener('click', (ev) => { if (!ev.target.closest('#ctxMenu')) menu.classList.add('hidden'); }, { once: true });
    }

    // garante campos extras no modal (staff + cliente)
    function ensureBookingExtraFields(modal) {
        const body = modal.querySelector('.bm-body') || modal;
        let ext = body.querySelector('#bmExt');
        if (!ext) {
            ext = document.createElement('div');
            ext.id = 'bmExt';
            ext.style.marginTop = '8px';
            ext.innerHTML = `
              <div style="display:grid;gap:8px;">
                <div id="bmStaffWrap" style="display:none;">
                  <label style="font-size:.85rem;opacity:.8;display:block;margin:2px 0 4px;">Colaborador</label>
                  <select id="bmStaff" style="width:100%;padding:6px 8px;border:1px solid #e0e0e0;border-radius:6px;"></select>
                </div>
                <div id="bmClientWrap">
                  <label style="font-size:.85rem;opacity:.8;display:block;margin:2px 0 4px;">Cliente</label>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                    <input id="bmClientFirst" placeholder="Nome"  style="width:100%;padding:6px 8px;border:1px solid #e0e0e0;border-radius:6px;">
                    <input id="bmClientLast"  placeholder="Sobrenome" style="width:100%;padding:6px 8px;border:1px solid #e0e0e0;border-radius:6px;">
                  </div>
                </div>
              </div>`;
            body.appendChild(ext);
        }
        return {
            staffWrap: ext.querySelector('#bmStaffWrap'),
            staffSel: ext.querySelector('#bmStaff'),
            clientWrap: ext.querySelector('#bmClientWrap'),
            firstInp: ext.querySelector('#bmClientFirst'),
            lastInp: ext.querySelector('#bmClientLast')
        };
    }

    function openBookingDialog(kind, rangePref, editInfo) {
        const modal = els.bookingModal; if (!modal) return;
        const { step, busy, seedStart, defaultLen } = buildTimeOptions(rangePref);

        const modalBody = modal.querySelector('.bm-body'); if (modalBody) { modalBody.style.maxHeight = '60vh'; modalBody.style.overflowY = 'auto'; }
        els.bmTitle && (els.bmTitle.textContent = editInfo ? 'Editar horário' : (kind === 'block' ? 'Bloqueio de horário' : (kind === 'timeoff' ? 'Adicionar folga' : 'Novo agendamento')));

        const makeStartOptions = () => { let html = ''; for (let t = WORK_START(); t <= WORK_END() - step; t += step) if (t + defaultLen <= WORK_END() && !collides(t, t + defaultLen, busy)) html += `<option value="${t}">${toLabel(t)}</option>`; return html; };
        const endsFromAny = (startMin) => { const vals = []; if (startMin < WORK_START() || startMin >= WORK_END()) return vals; for (let t = startMin + step; t <= WORK_END(); t += step) { if (collides(startMin, t, busy)) break; vals.push(t); } return vals; };

        const anyStartHtml = makeStartOptions(); if (!anyStartHtml) { alert('Não há horários disponíveis que comportem a duração padrão neste dia.'); return; }
        els.bmStart.innerHTML = anyStartHtml;
        const firstValidStart = Number((els.bmStart.querySelector('option') || {}).value);
        const hasSeed = [...els.bmStart.options].some(o => Number(o.value) === seedStart);
        els.bmStart.value = String(hasSeed ? seedStart : firstValidStart);

        function refreshEnds() {
            const s = Number(els.bmStart.value); const list = endsFromAny(s);
            if (!list.length) { els.bmEnd.innerHTML = '<option value="">—</option>'; els.bmEnd.value = ''; return; }
            els.bmEnd.innerHTML = list.map(t => `<option value="${t}">${toLabel(t)}</option>`).join('');
            const desired = Math.ceil((s + defaultLen) / step) * step; els.bmEnd.value = String(list.find(t => t >= desired) ?? list.at(-1));
        }
        refreshEnds(); els.bmStart.onchange = refreshEnds;

        // ------- campos extras: staff + cliente -------
        const { staffWrap, staffSel, clientWrap, firstInp, lastInp } = ensureBookingExtraFields(modal);
        if (isAdmin) {
            staffWrap.style.display = '';
            staffSel.innerHTML = state.staff.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
            const presetStaffId = editInfo ? (getApptById(editInfo.id)?.staffId || chosenStaffId()) : chosenStaffId();
            staffSel.value = String(presetStaffId);
        } else {
            staffWrap.style.display = 'none';
        }

        // cliente: visível somente para agendamento normal
        clientWrap.style.display = (kind === 'appt') ? '' : 'none';

        if (editInfo) {
            const current = getApptById(editInfo.id);
            if (current) {
                const s = toMinFromDate(current.start), e = toMinFromDate(current.end); const options = [...els.bmStart.options].map(o => Number(o.value));
                const cand = options.includes(s) ? s : (options.find(x => x >= s) ?? options[0]); els.bmStart.value = String(cand);
                const list = endsFromAny(cand); els.bmEnd.innerHTML = list.map(t => `<option value="${t}">${toLabel(t)}</option>`).join('');
                const desired = Math.ceil((cand + defaultLen) / step) * step; els.bmEnd.value = String(list.includes(e) ? e : (list.find(t => t >= desired) ?? list.at(-1)));
                firstInp.value = current.clientFirstName || (current.client && current.client !== 'Esporádico' ? current.client.split(' ')[0] : 'Esporádico');
                lastInp.value = current.clientLastName || '';
            }
        } else {
            firstInp.value = 'Esporádico'; lastInp.value = '';
        }

        const close = () => modal.classList.add('hidden');
        els.bmCancel.onclick = close; els.bmClose.onclick = close; const backdrop = modal.querySelector('.bm-backdrop'); backdrop && (backdrop.onclick = close);

        // 1) SUBSTITUA INTEIRO o handler de salvar do modal (els.bmSave.onclick) por este:
        els.bmSave.onclick = async () => {
            const s = Number(els.bmStart.value), e = Number(els.bmEnd.value);
            if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;

            const staffId = isAdmin ? (staffSel.value || chosenStaffId()) : chosenStaffId();
            const firstName = (firstInp.value || '').trim() || 'Esporádico';
            const lastName = (lastInp.value || '').trim();
            const excludeId = editInfo?.id || null;

            // valida: expediente + disponibilidade + sem colisão (lado cliente)
            if (!isRangeAllowed(s, e, excludeId)) {
                alert('Horário indisponível (fora do expediente, sem disponibilidade ou conflita com outro horário).');
                return;
            }

            try {
                if (editInfo?.id) {
                    await apiUpdateAppointment(editInfo.id, s, e, {
                        staffId,
                        clientName: `${firstName}${lastName ? ' ' : ''}${lastName}`.trim() || 'Esporádico'
                    });
                } else {
                    if (kind === 'block' || kind === 'timeoff') {
                        await apiCreateBlock(s, e, kind, { staffId });
                    } else {
                        await apiCreateAppointment(s, e, { staffId, firstName, lastName });
                    }
                }
                await refresh(false);
            } finally {
                modal.classList.add('hidden');
            }
        };
        modal.classList.remove('hidden');
    }

    function createPlaceholder(kind, startMin, endMin, details = {}) {
        if (!withinBusiness(startMin, endMin)) return;

        const d = state.date;
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); s.setMinutes(startMin);
        const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); e.setMinutes(endMin);

        const staffId = details.staffId || chosenStaffId();
        const staff = state.staff.find(x => x.id === staffId);
        const firstName = details.firstName || 'Esporádico';
        const lastName = details.lastName || '';
        const clientLabel = (kind === 'appt') ? formatClientName(firstName, lastName, 'Esporádico') : `Bloqueio – ${staff?.name || ''}`;

        const tempId = `temp-${Date.now()}`;
        const temp = {
            id: tempId,
            start: s,
            end: e,
            staffId,
            staffName: staff?.name || '',
            clientFirstName: (kind === 'appt') ? firstName : '',
            clientLastName: (kind === 'appt') ? lastName : '',
            client: clientLabel,
            service: '',
            color: (kind === 'appt') ? '#2196f3' : '#90a4ae',
            pending: true,
            locked: (kind !== 'appt'),
            kind
        };
        state.appts.push(temp);
        upsertLocalPlaceholder(state.date, { ...temp, start: s.toISOString(), end: e.toISOString() });
        renderDay();

        if (kind === 'appt') {
            apiCreateAppointment(startMin, endMin, tempId, { staffId, firstName, lastName });
        } else {
            apiCreateBlock(startMin, endMin, kind, tempId);
        }
    }

    function applyGhost(card, startMin, endMin) { card.style.top = `${minutesToTop(startMin)}px`; card.style.height = `${minutesToHeight(startMin, endMin)}px`; card.dataset.startMin = String(startMin); card.dataset.endMin = String(endMin); }

    // ======= FAB =======
    function wireFab() { if (!els.fab) return; els.fab.onclick = () => { const now = new Date(); const nowM = now.getHours() * 60 + now.getMinutes(); const startMin = Math.max(WORK_START(), Math.min(roundToStep(nowM), WORK_END() - config.defaultDurationMin)); openBookingDialog('appt', { startMin, endMin: startMin + config.defaultDurationMin }); }; }
    function wireLegacyFabMenu() {
        const menu = document.getElementById('fabMenu'), fabBtn = document.getElementById('fab'); if (!menu || !fabBtn) return;
        fabBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
        window.addEventListener('click', () => menu.classList.add('hidden'));
        const nowRange = () => { const now = new Date(); const nowM = now.getHours() * 60 + now.getMinutes(); const startMin = Math.max(WORK_START(), Math.min(roundToStep(nowM), WORK_END() - config.defaultDurationMin)); return { startMin, endMin: startMin + config.defaultDurationMin }; };
        menu.querySelectorAll('button,.fab-item').forEach(btn => {
            const act = (btn.dataset.action || btn.dataset.act || '').toLowerCase();
            btn.onclick = (e) => { e.stopPropagation(); menu.classList.add('hidden'); const r = nowRange(); if (act === 'new' || btn.textContent.toLowerCase().includes('marcar')) openBookingDialog('appt', r); else if (act === 'block' || btn.textContent.toLowerCase().includes('bloquear')) openBookingDialog('block', r); };
        });
    }

    // ======= API agendamentos =======
    // 2) SUBSTITUA a função apiCreateAppointment por esta (sem placeholders locais):
    async function apiCreateAppointment(startMin, endMin, extra = {}) {
        const d = state.date;
        const { utcStart, utcEnd } = makeDatesFromMinutes(d, startMin, endMin);

        const fn = (extra.firstName || 'Esporádico').trim();
        const ln = (extra.lastName || '').trim();
        const clientName = `${fn}${ln ? ' ' : ''}${ln}` || 'Esporádico';

        const body = {
            StaffId: extra.staffId || chosenStaffId(),
            StartUtc: utcStart.toISOString(),   // <<< UTC correto
            EndUtc: utcEnd.toISOString(),     // <<< UTC correto
            Kind: 'appt',
            ClientName: clientName
        };

        await apiSend('POST', '/appointments', body);
    }

    // 3) SUBSTITUA a função apiCreateBlock por esta (também SEM nada local):
    async function apiCreateBlock(startMin, endMin, kind, { staffId } = {}) {
        const d = state.date;
        const { utcStart, utcEnd } = makeDatesFromMinutes(d, startMin, endMin);

        const body = {
            StaffId: staffId || chosenStaffId(),
            StartUtc: utcStart.toISOString(),
            EndUtc: utcEnd.toISOString(),
            Kind: (kind === 'timeoff' ? 'timeoff' : 'block'),
            ClientName: null
        };

        await apiSend('POST', '/appointments', body);
    }

    async function apiUpdateAppointment(id, startMin, endMin, options = {}) {
        const d = state.date;
        const { utcStart, utcEnd } = makeDatesFromMinutes(d, startMin, endMin);

        const body = { StartUtc: utcStart.toISOString(), EndUtc: utcEnd.toISOString() };
        if (options.staffId) body.StaffId = options.staffId;

        if (typeof options.clientName === 'string') {
            body.ClientName = options.clientName.trim();
        } else if (options.firstName || options.lastName) {
            const fn = (options.firstName || 'Esporádico').trim();
            const ln = (options.lastName || '').trim();
            body.ClientName = `${fn}${ln ? ' ' : ''}${ln}` || 'Esporádico';
        }

        await apiSend('PUT', `/appointments/${encodeURIComponent(id)}`, body);
    }

    async function apiDeleteAppointment(id) { try { await apiSend('DELETE', `/appointments/${encodeURIComponent(id)}`); } catch (e) { console.warn('apiDeleteAppointment failed', e); } }

    // ======= INIT =======
    lockBodyScrollAndSize();
    renderMiniCal(state.date);
    refresh();

    async function refresh(rebuildMini = true) {
        try {
            if (rebuildMini) renderMiniCal(state.date);
            if (!state.staff.length) await loadStaff();
            await ensureEffectiveSettings();
            await loadAppointments();
            await loadAvailability();
            renderDay();
            wireFab();
            wireLegacyFabMenu();
        } catch (err) {
            console.error(err);
            els.calendar.innerHTML = `
                <div class="calendar-error">
                  <div class="calendar-error__title">Ops!</div>
                  <div class="calendar-error__msg">${(err.message || 'Falha ao carregar.')}</div>
                  <div class="calendar-error__hint">Verifique sua conexão e tente novamente.</div>
                </div>`;
        }
    }
    function makeDatesFromMinutes(day, startMin, endMin) {
        const localStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
        localStart.setMinutes(startMin);
        const localEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
        localEnd.setMinutes(endMin);

        // Constrói as versões UTC preservando o horário local escolhido:
        const utcStart = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0));
        utcStart.setUTCMinutes(startMin);
        const utcEnd = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0));
        utcEnd.setUTCMinutes(endMin);

        return { localStart, localEnd, utcStart, utcEnd };
    }
})();
