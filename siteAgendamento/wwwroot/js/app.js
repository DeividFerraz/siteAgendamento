// PATH: wwwroot/js/app.js
(function () {
    console.log('APP_JS_BUILD', '2025-10-06-fix-click-menu + revert-offhours + suppress-click-after-drag'
        /* [SOREN-MOD:001] add-company-and-availability */, '+ company-config + availability');

    // ======= helpers/estado =======
    const token = localStorage.getItem('soren.token');
    const tenant = localStorage.getItem('soren.tenant_slug');
    const role = (localStorage.getItem('soren.role') || '').toLowerCase();
    const myStaffId = localStorage.getItem('soren.staff_id') || null;
    const isAdmin = role === 'owner' || role === 'admin';

    if (!token || !tenant) {
        window.location.href = '/login.html';
        return;
    }

    const state = {
        date: new Date(),
        staff: [],
        selectedStaffIds: [],
        appts: [],            // {id, start, end, staffId, staffName, client, service, color, kind?, pending?, locked?}
        isAdmin,
        availability: { freeRanges: [] } // [SOREN-MOD:010] new holder for daily free ranges
    };

    // ======= grade/ajuda =======
    let gridMetrics = { startMinutes: 0, endMinutes: 24 * 60, pxPerMinute: 80 / 60 }; // 80px = 1h
    const config = { slotStepMin: 5, defaultDurationMin: 30 };

    /* ===== [SOREN-MOD:020] dynamic business settings (replaces hardcoded WORK_START/END) ===== */
    const business = {
        tz: 'America/Sao_Paulo',
        openMin: 7 * 60,
        closeMin: 20 * 60,
        daysOpen: new Set([1, 2, 3, 4, 5]),
        stepMin: 5,
        defaultAppointmentMin: 30
    };
    function WORK_START() { return business.openMin; }
    function WORK_END() { return business.closeMin; }

    function roundToStep(min) {
        const step = Math.max(1, Number(config.slotStepMin) || 5);
        return Math.round(min / step) * step;
    }
    function yToMinutes(y) {
        const m = gridMetrics.startMinutes + (y / gridMetrics.pxPerMinute);
        return Math.min(gridMetrics.endMinutes, Math.max(gridMetrics.startMinutes, roundToStep(m)));
    }
    function minutesToTop(m) { return (m - gridMetrics.startMinutes) * gridMetrics.pxPerMinute; }
    function minutesToHeight(startM, endM) { return Math.max(22, (endM - startM) * gridMetrics.pxPerMinute); }
    /* [SOREN-MOD:030] uses open days + dynamic open/close */
    function withinBusiness(startMin, endMin) {
        const wd = state.date.getDay();
        if (!business.daysOpen.has(wd)) return false;
        return startMin >= WORK_START() && endMin <= WORK_END();
    }

    function toLabel(min) {
        const h = Math.floor(min / 60).toString().padStart(2, '0');
        const m = (min % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }
    function toMinFromDate(d) { return d.getHours() * 60 + d.getMinutes(); }
    const isSameDay = (a, b) => a.toDateString() === b.toDateString();

    // ======= Persistência local de placeholders =======
    function dayKey(date) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        return `${tenant}::${y}-${m}-${dd}`;
    }
    function loadLocalPlaceholders(date) {
        const key = `soren.local_appts::${dayKey(date)}`;
        try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
    }
    function saveLocalPlaceholders(date, items) {
        const key = `soren.local_appts::${dayKey(date)}`;
        localStorage.setItem(key, JSON.stringify(items || []));
    }
    function upsertLocalPlaceholder(date, item) {
        const items = loadLocalPlaceholders(date);
        const idx = items.findIndex(x => x.id === item.id);
        if (idx >= 0) items[idx] = item; else items.push(item);
        saveLocalPlaceholders(date, items);
    }
    function removeLocalPlaceholder(date, id) {
        const items = loadLocalPlaceholders(date).filter(x => x.id !== id);
        saveLocalPlaceholders(date, items);
    }

    function busyIntervalsForSelectedStaff() {
        const chosen = chosenStaffId();
        const ranges = state.appts
            .filter(a => !chosen || a.staffId === chosen)
            .map(a => [toMinFromDate(a.start), toMinFromDate(a.end)])
            .sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const r of ranges) {
            if (!merged.length || r[0] > merged[merged.length - 1][1]) merged.push([...r]);
            else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
        }
        return merged;
    }
    function collides(startMin, endMin, busy) {
        return busy.some(([s, e]) => !(endMin <= s || startMin >= e));
    }

    // seed para o modal (mantém expediente), mas modal lista 00–24
    function buildTimeOptions(rangePref) {
        const step = Math.max(1, Number(config.slotStepMin) || 5);

        // ocupa dos cards ou invertendo availability
        let busy = busyIntervalsForSelectedStaff();
        if (state.availability?.freeRanges?.length) {
            const invert = (free) => {
                const start = WORK_START(), end = WORK_END();
                const ranges = [];
                let cursor = start;
                for (const [s, e] of free.sort((a, b) => a[0] - b[0])) {
                    if (s > cursor) ranges.push([cursor, s]);
                    cursor = Math.max(cursor, e);
                }
                if (cursor < end) ranges.push([cursor, end]);
                return ranges;
            };
            busy = invert(state.availability.freeRanges);
        }

        // [SOREN-PATCH] duração padrão efetiva
        const defaultLen = Math.max(
            step,
            Number(business.defaultAppointmentMin || config.defaultDurationMin || step)
        );

        function endsFrom(startMin) {
            const ends = [];
            for (let t = startMin + step; t <= WORK_END(); t += step) {
                if (collides(startMin, t, busy)) break; // bateu em ocupado → para
                ends.push(t);
            }
            return ends;
        }

        // [SOREN-PATCH] só entra em starts quem comporta a duração padrão (>= defaultLen)
        const starts = [];
        for (let t = WORK_START(); t <= WORK_END() - step; t += step) {
            if (collides(t, t + step, busy)) continue; // já começa batendo
            const ends = endsFrom(t);
            if (!ends.length) continue;

            // precisa existir algum fim com pelo menos defaultLen a partir de t
            if (ends.some(e => (e - t) >= defaultLen)) {
                starts.push(t);
            }
        }

        // semente para o início
        let seedStart = rangePref?.startMin ?? null;
        if (seedStart != null) {
            seedStart = roundToStep(Math.max(WORK_START(), Math.min(seedStart, WORK_END() - step)));
            if (!starts.includes(seedStart)) {
                seedStart = starts.find(s => s >= seedStart) ?? starts[0];
            }
        } else {
            seedStart = starts[0] ?? WORK_START();
        }

        // fins a partir do início
        const seedEnds = endsFrom(seedStart);

        // [SOREN-PATCH] tentar o fim = início + duração padrão; senão, pega o último permitido
        const desiredEnd = seedStart + defaultLen;
        let seedEnd = (rangePref?.endMin && rangePref.endMin > seedStart)
            ? roundToStep(Math.min(rangePref.endMin, WORK_END()))
            : desiredEnd;

        // se não existe opção >= desiredEnd, usar a última opção válida (garantimos que existe)
        const firstGte = seedEnds.find(e => e >= desiredEnd);
        seedEnd = firstGte ?? seedEnds[seedEnds.length - 1];

        return { step, busy, starts, endsFrom, seedStart, seedEnd, defaultLen };
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

    // ======= travar scroll do body e ajustar alturas =======
    function lockBodyScrollAndSize() {
        document.documentElement.style.height = '100%';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.height = '100vh';
        document.body.style.overflow = 'hidden';

        const topbarH = els.topbar ? els.topbar.getBoundingClientRect().height : 0;
        const extra = 24;
        const h = Math.max(320, window.innerHeight - topbarH - extra);
        if (els.calendar) {
            els.calendar.style.height = `${h}px`;
            els.calendar.style.overflowY = 'auto';
        }
        if (els.content) {
            els.content.style.height = `calc(100vh - ${Math.round(extra)}px)`;
            els.content.style.overflow = 'hidden';
        }
    }
    window.addEventListener('resize', () => {
        lockBodyScrollAndSize();
        if (isSameDay(state.date, new Date())) centerOnNow(false);
    });

    // ======= API base =======
    const apiBase = `${window.location.origin}/api/v1/${encodeURIComponent(tenant)}`;
    async function apiGet(path) {
        const res = await fetch(`${apiBase}${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) {
            let msg = '';
            try { msg = (await res.json()).message || ''; } catch { }
            if (!msg) { try { msg = (await res.text()).slice(0, 240); } catch { } }
            throw new Error(`${res.status} ${res.statusText} – ${msg || path}`);
        }
        return res.json();
    }

    // ======= UI topo =======
    els.tenantName && (els.tenantName.textContent = tenant);
    els.userName && (els.userName.textContent = role ? role[0].toUpperCase() + role.slice(1) : '');

    if (state.isAdmin) {
        if (els.navTeam) els.navTeam.hidden = false;
        if (els.staffPanel) els.staffPanel.hidden = false;
    } else {
        if (els.navTeam) els.navTeam.hidden = true;
        if (els.staffPanel) els.staffPanel.hidden = true;
        if (myStaffId) state.selectedStaffIds = [myStaffId];
    }

    if (els.btnPrev) els.btnPrev.onclick = () => { state.date.setDate(state.date.getDate() - 1); renderMiniCal(state.date); refresh(false); };
    if (els.btnNext) els.btnNext.onclick = () => { state.date.setDate(state.date.getDate() + 1); renderMiniCal(state.date); refresh(false); };
    if (els.btnToday) els.btnToday.onclick = () => { state.date = new Date(); renderMiniCal(state.date); refresh(false); };

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            showView(view);
        });
    });

    function showView(view) {
        if (els.teamView) els.teamView.classList.add('hidden');
        if (els.settingsView) els.settingsView.classList.add('hidden');
        if (workspace) workspace.style.display = 'none';

        if (view === 'agenda') {
            if (workspace) workspace.style.display = '';
            refresh();
        } else if (view === 'team') {
            renderTeamView();
            if (els.teamView) els.teamView.classList.remove('hidden');
        } else if (view === 'settings') {
            if (els.settingsView) els.settingsView.classList.remove('hidden');
        }
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

    // ======= Mini calendário =======
    function renderMiniCal(date) {
        if (!els.miniCal) return;
        const y = date.getFullYear();
        const m = date.getMonth();
        const first = new Date(y, m, 1);
        const start = new Date(first);
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
            const other = d.getMonth() !== m ? 'other' : '';
            const today = d.toDateString() === todayKey ? 'today' : '';
            const sel = d.toDateString() === state.date.toDateString() ? 'sel' : '';
            html += `<div class="day ${other} ${today} ${sel}" data-date="${d.toISOString()}">${d.getDate()}</div>`;
        }
        html += `</div>`;
        els.miniCal.innerHTML = html;

        document.getElementById('calPrev').onclick = () => { state.date = new Date(y, m - 1, state.date.getDate()); renderMiniCal(state.date); refresh(false); };
        document.getElementById('calNext').onclick = () => { state.date = new Date(y, m + 1, state.date.getDate()); renderMiniCal(state.date); refresh(false); };
        els.miniCal.querySelectorAll('.day').forEach(d => {
            d.addEventListener('click', () => {
                state.date = new Date(d.dataset.date);
                renderMiniCal(state.date);
                refresh(false);
            });
        });
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
        if (state.isAdmin) state.selectedStaffIds = [];
        renderStaffChips();
    }

    function renderStaffChips() {
        if (!state.isAdmin || !els.staffList) return;
        els.staffList.innerHTML = '';
        const allActive = state.selectedStaffIds.length === 0;
        const chipAll = createChip('Todos', allActive);
        chipAll.onclick = () => { state.selectedStaffIds = []; refresh(); syncChips(); };
        els.staffList.appendChild(chipAll);

        state.staff.forEach(s => {
            const active = state.selectedStaffIds.length === 0 || state.selectedStaffIds.includes(s.id);
            const chip = createChip(s.name, active, s.color);
            chip.onclick = () => {
                if (state.selectedStaffIds.length === 0) {
                    state.selectedStaffIds = [s.id];
                } else {
                    const idx = state.selectedStaffIds.indexOf(s.id);
                    if (idx >= 0) state.selectedStaffIds.splice(idx, 1);
                    else state.selectedStaffIds.push(s.id);
                    if (state.selectedStaffIds.length === 0) {
                        state.selectedStaffIds = [s.id];
                    }
                }
                refresh();
                syncChips();
            };
            chip.dataset.staffId = s.id;
            els.staffList.appendChild(chip);
        });

        function syncChips() {
            els.staffList.querySelectorAll('.staff-chip').forEach(ch => ch.classList.remove('active'));
            if (state.selectedStaffIds.length === 0) chipAll.classList.add('active');
            else {
                els.staffList.querySelectorAll('.staff-chip').forEach(ch => {
                    const id = ch.dataset.staffId;
                    if (id && state.selectedStaffIds.includes(id)) ch.classList.add('active');
                });
            }
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
        const startIsoUtc = start.toISOString();
        const endIsoUtc = end.toISOString();
        const staffParam = state.selectedStaffIds.length === 1 ? `&staffId=${encodeURIComponent(state.selectedStaffIds[0])}` : '';

        let fromBackend = [];
        try {
            const url = `/appointments?fromUtc=${encodeURIComponent(startIsoUtc)}&toUtc=${encodeURIComponent(endIsoUtc)}${staffParam}`;
            const data = await apiGet(url);
            fromBackend = normalizeAppts(data);
        } catch (_) {
            try {
                const dateParam = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const data = await apiGet(`/appointments/day?date=${dateParam}${staffParam}`);
                fromBackend = normalizeAppts(data);
            } catch {
                try {
                    const data = await apiGet(`/appointments/range?fromUtc=${encodeURIComponent(startIsoUtc)}&toUtc=${encodeURIComponent(endIsoUtc)}${staffParam}`);
                    fromBackend = normalizeAppts(data);
                } catch {
                    const data = await apiGet(`/appointments?from=${encodeURIComponent(startIsoUtc)}&to=${encodeURIComponent(endIsoUtc)}${staffParam}`);
                    fromBackend = normalizeAppts(data);
                }
            }
        }

        const locals = loadLocalPlaceholders(state.date).map(p => ({
            ...p,
            start: new Date(p.start),
            end: new Date(p.end),
        }));

        const map = new Map();
        [...fromBackend, ...locals].forEach(a => map.set(String(a.id), a));
        state.appts = Array.from(map.values());
    }

    function normalizeAppts(raw) {
        const list = raw.items || raw || [];
        return list.map((a, i) => {
            const start = new Date(a.startUtc || a.StartUtc || a.start || a.Start);
            const end = new Date(a.endUtc || a.EndUtc || a.end || a.End);
            const staffId = a.staffId || a.StaffId || myStaffId || null;
            const staff = state.staff.find(s => s.id === staffId);
            return {
                id: a.id || a.Id || `appt-${i}`,
                start, end,
                staffId, staffName: staff ? staff.name : (a.staffName || a.StaffName || ''),
                client: a.clientName || a.ClientName || a.client?.name || '',
                service: a.serviceName || a.ServiceName || '',
                color: staff?.color || '#7ee2b3',
                kind: (a.kind || a.Kind || undefined),
                pending: !!(a.pending || a.Pending),
                locked: !!(a.locked || a.Locked)
            };
        });
    }

    /* ===== [SOREN-MOD:050] Availability (slots:search) ===== */
    async function loadAvailability() {
        const d = new Date(state.date.getFullYear(), state.date.getMonth(), state.date.getDate());
        const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0));
        const to = new Date(from); to.setUTCDate(to.getUTCDate() + 1);

        const staffId = chosenStaffId();
        const body = {
            ServiceId: "00000000-0000-0000-0000-000000000000", // ajuste se seu serviço for obrigatório
            DateRange: { FromUtc: from.toISOString(), ToUtc: to.toISOString() },
            StaffIds: staffId ? [staffId] : null
        };

        try {
            const res = await fetch(`${apiBase}/availability/slots:search`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(await res.text());
            const slots = await res.json();

            // normalização: converte pontos disponíveis em "faixas livres"
            const toMin = (iso) => { const x = new Date(iso); return x.getHours() * 60 + x.getMinutes(); };
            let freeRanges = [];

            if (Array.isArray(slots) && slots.length && ('available' in (slots[0] || {}))) {
                const step = Math.max(1, Number(config.slotStepMin) || 5);
                let run = null;
                for (const s of slots) {
                    const m = toMin(s.timeUtc || s.time || s.TimeUtc);
                    if (s.available) {
                        if (!run) run = [m, m + step]; else run[1] = m + step;
                    } else if (run) { freeRanges.push(run); run = null; }
                }
                if (run) freeRanges.push(run);
            } else if (slots?.free) {
                // caso seu service já devolva ranges: [[startIso,endIso],...]
                freeRanges = slots.free.map(([a, b]) => [toMin(a), toMin(b)]);
            }

            // limita ao expediente
            state.availability = {
                freeRanges: freeRanges
                    .map(([s, e]) => [Math.max(WORK_START(), s), Math.min(WORK_END(), e)])
                    .filter(([s, e]) => e > s)
            };
        } catch (e) {
            console.warn('loadAvailability()', e);
            state.availability = { freeRanges: [] };
        }
    }

    // ======= Render grade do dia =======
    function renderDay() {
        if (!els.calendar) return;

        lockBodyScrollAndSize();

        const fmt = state.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
        if (els.dayTitle) els.dayTitle.textContent = fmt.replaceAll('.', '');
        if (els.openState) els.openState.textContent = '';

        const chipDate = document.getElementById('chipDate');
        const chipOpenState = document.getElementById('chipOpenState');
        if (chipDate) chipDate.textContent = els.dayTitle.textContent;

        /* [SOREN-MOD:060] aberto/fechado via business.daysOpen */
        const wd = state.date.getDay();
        const isOpen = business.daysOpen.has(wd);
        if (chipOpenState) chipOpenState.textContent = isOpen ? 'Aberto' : 'Fechado';
        if (els.openState) els.openState.textContent = isOpen ? 'Aberto' : 'Fechado';

        const hoursCol = document.createElement('div');
        hoursCol.className = 'hours';
        for (let h = 0; h <= 23; h++) {
            const div = document.createElement('div');
            div.className = 'h';
            div.textContent = `${h.toString().padStart(2, '0')}:00`;
            hoursCol.appendChild(div);
        }

        const grid = document.createElement('div');
        grid.className = 'grid';

        const startMinutes = 0;
        const endMinutes = 24 * 60;
        const pxPerMinute = 80 / 60;
        gridMetrics = { startMinutes, endMinutes, pxPerMinute };

        const dayBody = document.createElement('div');
        dayBody.style.height = `${minutesToHeight(0, 24 * 60)}px`;
        dayBody.style.pointerEvents = 'none';
        grid.appendChild(dayBody);

        // off-hours overlays (pointer-events: none no CSS)
        const ohTop = document.createElement('div');
        ohTop.className = 'offhours';
        ohTop.style.top = `${minutesToTop(0)}px`;
        ohTop.style.height = `${minutesToHeight(0, WORK_START())}px`;
        grid.appendChild(ohTop);

        const ohBottom = document.createElement('div');
        ohBottom.className = 'offhours';
        ohBottom.style.top = `${minutesToTop(WORK_END())}px`;
        ohBottom.style.height = `${minutesToHeight(WORK_END(), 24 * 60)}px`;
        grid.appendChild(ohBottom);

        const now = new Date();
        if (isSameDay(now, state.date)) {
            const nowM = now.getHours() * 60 + now.getMinutes();
            const top = Math.max(0, (nowM - startMinutes) * pxPerMinute);
            const nowLine = document.createElement('div');
            nowLine.className = 'nowline';
            nowLine.style.top = `${top}px`;
            grid.appendChild(nowLine);
        }

        // cards
        state.appts.forEach(a => {
            const sM = a.start.getHours() * 60 + a.start.getMinutes();
            const eM = a.end.getHours() * 60 + a.end.getMinutes();
            const top = (sM - startMinutes) * pxPerMinute;
            const height = Math.max(22, (eM - sM) * pxPerMinute);

            const card = document.createElement('div');
            card.className = 'appt';
            if (a.locked) card.classList.add('locked');
            if (a.pending) card.classList.add('pending');

            card.style.top = `${top}px`;
            card.style.height = `${height}px`;
            card.style.borderColor = a.pending ? 'var(--primary)' : `${a.color}`;
            card.style.borderStyle = a.kind === 'block' ? 'dashed' : 'solid';
            card.innerHTML = `
        <div class="t">${pad(a.start)} — ${pad(a.end)}</div>
        <div class="s">${escapeHtml(a.client || (a.pending ? (a.kind === 'block' ? 'Bloqueio (pendente)' : 'Agendamento (pendente)') : '—'))}${a.staffName ? ` • ${escapeHtml(a.staffName)}` : ''}</div>
      `;
            card.dataset.apptId = String(a.id || `appt-${sM}-${eM}`);
            card.dataset.startMin = String(sM);
            card.dataset.endMin = String(eM);

            if (!a.locked) {
                const hTop = document.createElement('div'); hTop.className = 'handle top';
                const hBot = document.createElement('div'); hBot.className = 'handle bot';
                card.appendChild(hTop); card.appendChild(hBot);
            }
            grid.appendChild(card);
        });

        els.calendar.innerHTML = '';
        els.calendar.appendChild(hoursCol);
        els.calendar.appendChild(grid);

        // roda o scroll da coluna de horas junto com a grade (smooth)
        hoursCol.addEventListener('wheel', (ev) => {
            const delta = ev.deltaY || ev.wheelDelta || 0;
            els.calendar.scrollTop += delta;
            ev.preventDefault();
        }, { passive: false });

        wireGridInteractions(grid);

        function pad(d) {
            return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        centerOnNow(true);
    }

    function centerOnNow(firstRender) {
        if (!els.calendar) return;
        let targetMin;
        const now = new Date();
        if (isSameDay(now, state.date)) {
            targetMin = now.getHours() * 60 + now.getMinutes();
        } else {
            targetMin = WORK_START();
        }
        const targetTop = minutesToTop(targetMin);
        const offset = Math.max(0, targetTop - (els.calendar.clientHeight * 0.33));
        els.calendar.scrollTo({ top: offset, behavior: firstRender ? 'auto' : 'smooth' });
    }

    // ======= Team view =======
    async function renderTeamView() {
        if (!state.isAdmin) return;
        if (!state.staff.length) await loadStaff();
        const el = document.getElementById('teamTable');
        if (!el) return;
        el.innerHTML = state.staff.map(s =>
            `<div class="staff-row"><strong style="color:${s.color}">${escapeHtml(s.name)}</strong> · ID: ${s.id}</div>`
        ).join('') || '<div class="muted">Sem colaboradores cadastrados.</div>';
    }

    // ======= util =======
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
    function pickColor(i) {
        const pal = ['#2dc780', '#64b5f6', '#ffb74d', '#ba68c8', '#4db6ac', '#7986cb', '#81c784', '#e57373', '#4dd0e1'];
        return pal[i % pal.length];
    }
    function chosenStaffId() {
        if (state.selectedStaffIds.length === 1) return state.selectedStaffIds[0];
        if (!state.isAdmin && myStaffId) return myStaffId;
        if (state.staff.length) return state.staff[0].id;
        return null;
    }
    function getApptById(id) {
        return state.appts.find(a => String(a.id) === String(id)) || null;
    }

    // ======= refresh =======
    async function refresh(rebuildMini = true) {
        try {
            if (rebuildMini) renderMiniCal(state.date);
            if (!state.staff.length) await loadStaff();
            await loadAppointments();
            await loadAvailability(); // [SOREN-MOD:070] plug availability before rendering
            renderDay();
            wireFab();
            wireLegacyFabMenu();
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

    // ======= branding + settings =======
    /* [SOREN-MOD:080] new: loadCompany compõe tudo p/ front (cores, horários, dias, granularidade, duração) */
    function hhmmToMin(hhmm) {
        const [h, m] = String(hhmm || '').split(':').map(Number);
        return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? (m || 0) : 0);
    }

    /* [SOREN-FIX:102] aceita dias como números ou strings (PT/EN), devolvendo Set de 0..6 (Dom=0) */
    function normalizeDays(days) {
        if (!Array.isArray(days)) return new Set([1, 2, 3, 4, 5]); // padrão: seg-sex
        const map = {
            // EN
            'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6,
            // PT curto
            'dom': 0, 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sáb': 6, 'sab': 6,
            // PT longo
            'domingo': 0, 'segunda': 1, 'segunda-feira': 1, 'terca': 2, 'terça': 2, 'terça-feira': 2,
            'quarta': 3, 'quarta-feira': 3, 'quinta': 4, 'quinta-feira': 4, 'sexta': 5, 'sexta-feira': 5,
            'sabado': 6, 'sábado': 6
        };
        const out = new Set();
        for (const d of days) {
            if (typeof d === 'number' && d >= 0 && d <= 6) { out.add(d); continue; }
            const k = String(d || '').trim().toLowerCase();
            if (k in map) out.add(map[k]);
        }
        return out.size ? out : new Set([1, 2, 3, 4, 5]);
    }

    async function loadCompany() {
        try {
            // [SOREN-FIX:103] ler SETTINGS do tenant
            const s = await apiGet(`/settings`);

            // timezone (fallback)
            business.tz = s.timezone || s.Timezone || business.tz;

            // horários
            business.openMin = hhmmToMin(s.openTime || s.OpenTime || '07:00');
            business.closeMin = hhmmToMin(s.closeTime || s.CloseTime || '20:00');

            // dias abertos
            const days = s.businessDays || s.BusinessDays || [];
            business.daysOpen = normalizeDays(days);

            // granularidade & duração padrão
            business.stepMin = Number(s.slotGranularityMinutes || s.SlotGranularityMinutes || business.stepMin);
            business.defaultAppointmentMin = Number(s.defaultAppointmentMinutes || s.DefaultAppointmentMinutes || business.defaultAppointmentMin);
            config.slotStepMin = business.stepMin;
            config.defaultDurationMin = business.defaultAppointmentMin;

            // cores (deixe aqui por compat; seu /branding já é carregado em loadTenantConfig)
            try {
                const b = await apiGet(`/branding`);
                const primary = b.primaryColor || b.Primary || b.primary || '#16a765';
                const secondary = b.secondaryColor || b.Secondary || b.secondary || '#6dd8a9';
                const ink = b.tertiaryColor || b.Tertiary || b.ink || '#0b2f21';
                applyBranding(primary, secondary, ink);
            } catch { /* ignora se falhar */ }

            // nome da empresa (se veio junto em settings)
            if ((s.companyName || s.CompanyName) && els.tenantName) {
                els.tenantName.textContent = s.companyName || s.CompanyName;
            }
        } catch (e) {
            console.warn('loadCompany()', e);
        }
    }

    async function loadTenantConfig() {
        try {
            const b = await apiGet(`/branding`);
            const primary = b.primaryColor || b.PrimaryColor || b.primary || b.Primary || '#16a765';
            const secondary = b.secondaryColor || b.SecondaryColor || b.secondary || b.Secondary || '#6dd8a9';
            const ink = b.tertiaryColor || b.TertiaryColor || b.ink || b.Ink || '#0b2f21';
            applyBranding(primary, secondary, ink);

            if (b.companyName && els.tenantName) {
                els.tenantName.textContent = b.companyName;
            }
        } catch { }

        try {
            const s = await apiGet(`/settings`);

            // [SOREN-FIX:011] — aplicar TODOS os campos novos vindos da API
            const hhmmToMin = (hhmm) => {
                const [h, m] = String(hhmm || '00:00').split(':').map(Number);
                return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
            };

            // step (granularidade)
            const slot2 = s.slotGranularityMinutes || s.SlotGranularityMinutes || s.slot_step_minutes;
            if (slot2) config.slotStepMin = Number(slot2) || config.slotStepMin;

            // duração padrão
            const def = Number(s.defaultAppointmentMinutes || s.DefaultAppointmentMinutes);
            if (def) {
                business.defaultAppointmentMin = def;
                config.defaultDurationMin = def;
            }

            // expediente
            business.openMin = hhmmToMin(s.openTime || s.OpenTime || '07:00');
            business.closeMin = hhmmToMin(s.closeTime || s.CloseTime || '20:00');

            // dias abertos (Mon..Sun → 0..6)
            business.daysOpen = mapDaysToSet(s.businessDays || s.BusinessDays || []);

            // timezone (se quiser usar em exibições)
            business.tz = s.timezone || s.Timezone || business.tz;

        } catch { }
    }
    function applyBranding(primary, secondary, ink) {
        const root = document.documentElement;
        if (primary) root.style.setProperty('--primary', primary);
        if (secondary) root.style.setProperty('--primary-soft', secondary);
        if (ink) root.style.setProperty('--ink', ink);
    }

    // ======= Interações (drag/resize/click + menus) =======
    let drag = null;
    let suppressClickAfterDrag = false; // evita abrir menu após arrastar
    const DRAG_THRESHOLD_PX = 3;

    function gridY(ev, scroller, grid) {
        const r = grid.getBoundingClientRect();
        return (ev.clientY - r.top) + scroller.scrollTop;
    }

    function updateApptInStateAndLocal(id, startMin, endMin) {
        const d = state.date;
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); s.setMinutes(startMin);
        const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); e.setMinutes(endMin);

        const item = state.appts.find(a => String(a.id) === String(id));
        if (item) { item.start = s; item.end = e; }

        if (String(id).startsWith('temp-')) {
            const local = loadLocalPlaceholders(state.date);
            const li = local.find(x => x.id === id);
            if (li) { li.start = s.toISOString(); li.end = e.toISOString(); upsertLocalPlaceholder(state.date, li); }
        }
    }

    function wireGridInteractions(grid) {
        const scroller = els.calendar;

        // criar seleção (menu de Novo/bloqueio/folga)
        grid.addEventListener('mousedown', (e) => {
            if (e.target.closest('.appt')) return;

            const y0 = gridY(e, scroller, grid);
            drag = { mode: 'create', startY: y0 };
            const startM = yToMinutes(y0);
            drag.startMin = startM;
            drag.endMin = startM + config.defaultDurationMin;

            const ghost = document.createElement('div');
            ghost.className = 'select-ghost';
            ghost.style.top = `${minutesToTop(Math.min(drag.startMin, drag.endMin))}px`;
            ghost.style.height = `${minutesToHeight(Math.min(drag.startMin, drag.endMin), Math.max(drag.startMin, drag.endMin))}px`;
            grid.appendChild(ghost);
            drag.ghost = ghost;

            const onMove = (ev) => {
                const y = Math.max(0, Math.min(scroller.scrollHeight, gridY(ev, scroller, grid)));
                const m = yToMinutes(y);
                drag.endMin = Math.max(m, drag.startMin + Math.max(1, Number(config.slotStepMin) || 5));
                const top = minutesToTop(Math.min(drag.startMin, drag.endMin));
                const h = minutesToHeight(Math.min(drag.startMin, drag.endMin), Math.max(drag.startMin, drag.endMin));
                ghost.style.top = `${top}px`;
                ghost.style.height = `${h}px`;
            };
            const onUp = (ev) => {
                grid.removeEventListener('mousemove', onMove);
                grid.removeEventListener('mouseup', onUp);
                if (ghost.parentNode) ghost.parentNode.removeChild(ghost);

                const range = {
                    startMin: Math.min(drag.startMin, drag.endMin),
                    endMin: Math.max(drag.startMin, drag.endMin)
                };
                drag = null;

                if (!withinBusiness(range.startMin, range.endMin)) {
                    console.warn('Fora do horário de funcionamento');
                    return;
                }
                openActionMenu(ev.clientX, ev.clientY, range);
            };
            grid.addEventListener('mousemove', onMove);
            grid.addEventListener('mouseup', onUp);
        });

        // mover/resize
        grid.addEventListener('mousedown', (e) => {
            const card = e.target.closest('.appt');
            if (!card) return;
            if (card.classList.contains('locked')) return;

            const sM0 = Number(card.dataset.startMin);
            const eM0 = Number(card.dataset.endMin);
            const step = Math.max(1, Number(config.slotStepMin) || 5);

            const startScrollTop = scroller.scrollTop;
            const startClientY = e.clientY;
            let didDrag = false;

            if (e.target.classList.contains('handle')) {
                drag = {
                    mode: e.target.classList.contains('top') ? 'resize-top' : 'resize-bot',
                    apptEl: card, startMin: sM0, endMin: eM0, startY: e.clientY, startScrollTop
                };
            } else {
                drag = { mode: 'move', apptEl: card, startMin: sM0, endMin: eM0, startY: e.clientY, startScrollTop };
            }
            card.classList.add('dragging');

            const onMove = (ev) => {
                const moveAbs = Math.abs(ev.clientY - startClientY);
                if (moveAbs > DRAG_THRESHOLD_PX) didDrag = true;

                const dy = (ev.clientY - drag.startY) + (scroller.scrollTop - drag.startScrollTop);
                const deltaMin = roundToStep(dy / gridMetrics.pxPerMinute);

                if (drag.mode === 'move') {
                    let ns = sM0 + deltaMin;
                    let ne = eM0 + deltaMin;
                    const len = ne - ns;
                    ns = Math.max(gridMetrics.startMinutes, Math.min(ns, gridMetrics.endMinutes - len));
                    ne = ns + len;
                    applyGhost(card, ns, ne);
                } else if (drag.mode === 'resize-top') {
                    let ns = Math.min(eM0 - step, sM0 + deltaMin);
                    ns = Math.max(gridMetrics.startMinutes, ns);
                    applyGhost(card, ns, eM0);
                } else if (drag.mode === 'resize-bot') {
                    let ne = Math.max(sM0 + step, eM0 + deltaMin);
                    ne = Math.min(gridMetrics.endMinutes, ne);
                    applyGhost(card, sM0, ne);
                }

                const ns = Number(card.dataset.startMin);
                const ne = Number(card.dataset.endMin);
                if (!withinBusiness(ns, ne)) card.classList.add('invalid');
                else card.classList.remove('invalid');
            };

            const onUp = async () => {
                grid.removeEventListener('mousemove', onMove);
                grid.removeEventListener('mouseup', onUp);
                card.classList.remove('dragging');

                const id = card.dataset.apptId || null;
                const ns = Number(card.dataset.startMin);
                const ne = Number(card.dataset.endMin);

                // Se saiu do expediente, reverte e NÃO abre nada
                if (!withinBusiness(ns, ne)) {
                    applyGhost(card, sM0, eM0);
                    card.classList.remove('invalid');
                    suppressClickAfterDrag = didDrag; // bloqueia click subsequente
                    drag = null;
                    return;
                }

                // Se houve arraste válido, aplica e suprime clique (não abre menu)
                if (didDrag && (ns !== sM0 || ne !== eM0)) {
                    updateApptInStateAndLocal(id, ns, ne);
                    await apiUpdateAppointment(id, ns, ne);
                    renderDay();
                    suppressClickAfterDrag = true;
                    drag = null;
                    return;
                }

                // Se não arrastou de fato, deixa fluir o clique normal
                suppressClickAfterDrag = false;
                drag = null;
            };
            grid.addEventListener('mousemove', onMove);
            grid.addEventListener('mouseup', onUp);
        });

        // CLICK no cartão => abrir menu Editar/Excluir
        grid.addEventListener('click', (e) => {
            if (suppressClickAfterDrag) { suppressClickAfterDrag = false; return; }

            const card = e.target.closest('.appt');
            if (!card) return;
            // não abrir menu se clicou no "handle" (área de resize)
            if (e.target.classList && e.target.classList.contains('handle')) return;

            e.stopPropagation();
            const id = card.dataset.apptId;
            const appt = getApptById(id);
            if (!appt) return;

            openApptMenu(e.clientX, e.clientY, appt);
        });
    }

    // ======= Menus =======
    function openActionMenu(x, y, range) {
        if (!els.ctx) return;
        els.ctx.innerHTML = [
            `<button data-act="new">Novo agendamento</button>`,
            `<button data-act="block">Novo bloqueio de horário</button>`,
            `<button data-act="timeoff">Adicionar folga</button>`
        ].join('');
        els.ctx.style.left = `${x}px`;
        els.ctx.style.top = `${y}px`;
        els.ctx.classList.remove('hidden');

        els.ctx.querySelectorAll('button').forEach(btn => {
            btn.onclick = () => {
                els.ctx.classList.add('hidden');
                const act = btn.dataset.act;
                if (act === 'new') openBookingDialog('appt', range);
                else if (act === 'block') openBookingDialog('block', range);
                else if (act === 'timeoff') openBookingDialog('timeoff', range);
            };
        });
        window.addEventListener('click', hideCtxOnce, { once: true });
        function hideCtxOnce(ev) { if (!ev.target.closest('#ctxMenu')) els.ctx.classList.add('hidden'); }
    }

    function openApptMenu(x, y, appt) {
        if (!els.ctx) return;
        els.ctx.innerHTML = [
            `<button data-act="edit">Editar horário</button>`,
            `<button data-act="del">Excluir</button>`
        ].join('');
        els.ctx.style.left = `${x}px`;
        els.ctx.style.top = `${y}px`;
        els.ctx.classList.remove('hidden');

        els.ctx.querySelector('[data-act="edit"]').onclick = () => {
            els.ctx.classList.add('hidden');
            const startMin = toMinFromDate(appt.start);
            const endMin = toMinFromDate(appt.end);
            openBookingDialog(appt.kind || 'appt', { startMin, endMin }, { id: String(appt.id) });
        };
        els.ctx.querySelector('[data-act="del"]').onclick = () => {
            els.ctx.classList.add('hidden');
            const id = String(appt.id);
            if (id.startsWith('temp-')) {
                state.appts = state.appts.filter(a => String(a.id) !== id);
                removeLocalPlaceholder(state.date, id);
                renderDay();
            } else {
                if (confirm('Cancelar este agendamento?')) {
                    apiDeleteAppointment(id).finally(() => refresh(false));
                }
            }
        };

        window.addEventListener('click', hideCtxOnce, { once: true });
        function hideCtxOnce(ev) { if (!ev.target.closest('#ctxMenu')) els.ctx.classList.add('hidden'); }
    }

    // ======= Modal (00–24) =======
    // editInfo = { id } quando estiver editando um card
    function openBookingDialog(kind, rangePref, editInfo) {
        if (!els.bookingModal) return;

        const { step, busy, starts, endsFrom, seedStart, defaultLen } = buildTimeOptions(rangePref);

        const modalBody = els.bookingModal.querySelector('.bm-body');
        if (modalBody) {
            modalBody.style.maxHeight = '60vh';
            modalBody.style.overflowY = 'auto';
        }

        if (els.bmTitle) {
            els.bmTitle.textContent =
                editInfo ? 'Editar horário' :
                    (kind === 'block' ? 'Novo bloqueio de horário' :
                        (kind === 'timeoff' ? 'Adicionar folga' : 'Novo agendamento'));
        }

        // ---- INÍCIOS: apenas horários que comportam a duração padrão inteira ----
        const makeStartOptions = () => {
            let html = '';
            for (let t = WORK_START(); t <= WORK_END() - step; t += step) {
                // precisa caber "defaultLen" sem colidir e sem ultrapassar o expediente
                if (t + defaultLen <= WORK_END() && !collides(t, t + defaultLen, busy)) {
                    html += `<option value="${t}">${toLabel(t)}</option>`;
                }
            }
            return html;
        };

        // Finais válidos (lista crescente), para um dado início
        const endsFromAny = (startMin) => {
            const vals = [];
            if (startMin < WORK_START() || startMin >= WORK_END()) return vals;
            for (let t = startMin + step; t <= WORK_END(); t += step) {
                if (collides(startMin, t, busy)) break;
                vals.push(t);
            }
            return vals;
        };

        // Se não couber nenhum início válido, aborta com aviso
        const anyStartHtml = makeStartOptions();
        if (!anyStartHtml) {
            alert('Não há horários disponíveis que comportem a duração padrão neste dia.');
            return;
        }

        els.bmStart.innerHTML = anyStartHtml;

        // escolhe um seedStart que esteja na lista; se não, usa o primeiro válido
        const firstValidStart = Number((els.bmStart.querySelector('option') || {}).value);
        const hasSeed = [...els.bmStart.options].some(o => Number(o.value) === seedStart);
        els.bmStart.value = String(hasSeed ? seedStart : firstValidStart);

        function refreshEnds() {
            const s = Number(els.bmStart.value);
            const list = endsFromAny(s);                  // [minutos]
            if (!list.length) {
                els.bmEnd.innerHTML = `<option value="">—</option>`;
                els.bmEnd.value = '';
                return;
            }

            // popula as opções
            els.bmEnd.innerHTML = list.map(t => `<option value="${t}">${toLabel(t)}</option>`).join('');

            // destino desejado: início + duração padrão (alinhado ao step p/ cima)
            const desired = Math.ceil((s + defaultLen) / step) * step;

            // pega o primeiro fim >= desired; se não existir, usa o último possível
            const chosen = list.find(t => t >= desired) ?? list[list.length - 1];
            els.bmEnd.value = String(chosen);
        }

        refreshEnds();
        els.bmStart.onchange = refreshEnds;

        // ---- Edição: preservar duração original quando possível ----
        if (editInfo) {
            const current = getApptById(editInfo.id);
            if (current) {
                const s = toMinFromDate(current.start);
                const e = toMinFromDate(current.end);
                // move o início para o mais próximo válido >= s (ou primeiro)
                const startOptions = [...els.bmStart.options].map(o => Number(o.value));
                const startCandidate = startOptions.includes(s) ? s : (startOptions.find(x => x >= s) ?? startOptions[0]);
                els.bmStart.value = String(startCandidate);

                const list = endsFromAny(startCandidate);
                els.bmEnd.innerHTML = list.map(t => `<option value="${t}">${toLabel(t)}</option>`).join('');
                // se o fim original couber, mantém; senão tenta (novo início + defaultLen); senão o último
                const desired = Math.ceil((startCandidate + defaultLen) / step) * step;
                const chosen = list.includes(e) ? e : (list.find(t => t >= desired) ?? list[list.length - 1]);
                els.bmEnd.value = String(chosen);
            }
        }

        function close() { els.bookingModal.classList.add('hidden'); }
        els.bmCancel.onclick = close;
        els.bmClose.onclick = close;
        const backdrop = els.bookingModal.querySelector('.bm-backdrop');
        if (backdrop) backdrop.onclick = close;

        els.bmSave.onclick = () => {
            const s = Number(els.bmStart.value);
            const e = Number(els.bmEnd.value);
            if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;
            if (!withinBusiness(s, e)) { alert('Fora do horário de funcionamento da empresa.'); return; }

            if (editInfo?.id) {
                updateApptInStateAndLocal(editInfo.id, s, e);
                apiUpdateAppointment(editInfo.id, s, e).finally(() => renderDay());
            } else {
                createPlaceholder(kind, s, e);
            }
            close();
        };

        els.bookingModal.classList.remove('hidden');
    }

    function createPlaceholder(kind, startMin, endMin) {
        if (!withinBusiness(startMin, endMin)) { console.warn('Tentativa de agendar fora do horário.'); return; }
        const d = state.date;
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); s.setMinutes(startMin);
        const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); e.setMinutes(endMin);

        const staffId = chosenStaffId();
        const staff = state.staff.find(x => x.id === staffId);

        const temp = {
            id: `temp-${Date.now()}`,
            start: s,
            end: e,
            staffId,
            staffName: staff?.name || '',
            client: '',
            service: '',
            color: staff?.color || 'var(--primary-soft)',
            pending: true,
            kind
        };

        state.appts.push(temp);
        upsertLocalPlaceholder(state.date, { ...temp, start: s.toISOString(), end: e.toISOString() });
        renderDay();

        if (kind === 'appt') apiCreateAppointment(startMin, endMin).then(() => { });
        else if (kind === 'block' || kind === 'timeoff') apiCreateBlock(startMin, endMin, kind).then(() => { });
    }

    function applyGhost(card, startMin, endMin) {
        card.style.top = `${minutesToTop(startMin)}px`;
        card.style.height = `${minutesToHeight(startMin, endMin)}px`;
        card.dataset.startMin = String(startMin);
        card.dataset.endMin = String(endMin);
    }

    // ======= FAB =======
    function wireFab() {
        if (!els.fab) return;
        els.fab.onclick = () => {
            const now = new Date();
            const nowM = now.getHours() * 60 + now.getMinutes();
            const startMin = Math.max(WORK_START(), Math.min(roundToStep(nowM), WORK_END() - config.defaultDurationMin));
            const endMin = startMin + config.defaultDurationMin;
            openBookingDialog('appt', { startMin, endMin });
        };
    }

    // ======= FAB LEGADO =======
    function wireLegacyFabMenu() {
        const menu = document.getElementById('fabMenu');
        const fabBtn = document.getElementById('fab');
        if (!menu || !fabBtn) return;

        fabBtn.onclick = (e) => {
            e.stopPropagation();
            menu.classList.toggle('hidden');
        };
        window.addEventListener('click', () => menu.classList.add('hidden'));

        function nowRange() {
            const now = new Date();
            const nowM = now.getHours() * 60 + now.getMinutes();
            const startMin = Math.max(WORK_START(), Math.min(roundToStep(nowM), WORK_END() - config.defaultDurationMin));
            return { startMin, endMin: startMin + config.defaultDurationMin };
        }

        menu.querySelectorAll('button, .fab-item').forEach(btn => {
            const act = (btn.dataset.action || btn.dataset.act || '').toLowerCase();
            btn.onclick = (e) => {
                e.stopPropagation();
                menu.classList.add('hidden');
                const r = nowRange();
                if (act === 'new' || btn.textContent.toLowerCase().includes('marcar')) {
                    openBookingDialog('appt', r);
                } else if (act === 'block' || btn.textContent.toLowerCase().includes('bloquear')) {
                    openBookingDialog('block', r);
                }
            };
        });
    }

    // ======= STUBS de API =======
    async function apiCreateAppointment(startMin, endMin) {
        const d = state.date;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); start.setMinutes(startMin);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); end.setMinutes(endMin);
        console.log('create appointment', { start, end, staffId: chosenStaffId() });
        // TODO: integrar com rota real de criação quando você enviar o path
    }
    async function apiCreateBlock(startMin, endMin, kind) {
        const d = state.date;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); start.setMinutes(startMin);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); end.setMinutes(endMin);
        console.log('create block/timeoff', { start, end, kind, staffId: chosenStaffId() });
    }
    async function apiUpdateAppointment(id, startMin, endMin) {
        const d = state.date;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); start.setMinutes(startMin);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); end.setMinutes(endMin);
        console.log('update appointment', { id, start, end });
    }
    async function apiDeleteAppointment(id) {
        console.log('delete appointment', { id });
    }

    // ======= INIT =======
    /* [SOREN-MOD:090] load company (expediente, dias, cores, step, duração) antes de renderizar */
    Promise.all([loadCompany(), loadTenantConfig()]).finally(() => {
        lockBodyScrollAndSize();
        renderMiniCal(state.date);
        refresh();
    });
})();
