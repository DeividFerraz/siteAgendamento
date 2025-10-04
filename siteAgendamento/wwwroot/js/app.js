// PATH: wwwroot/js/app.js
(function () {
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
        date: new Date(),             // dia selecionado
        staff: [],                    // {id, name, color}
        selectedStaffIds: [],         // vazio = todos
        appts: [],                    // agendamentos do dia
        isAdmin,
    };

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
    };
    // área principal do conteúdo (precisa existir no HTML)
    const workspace = document.querySelector('.workspace');

    // ======= API base =======
    const apiBase = `${window.location.origin}/api/v1/${encodeURIComponent(tenant)}`;

    async function apiGet(path) {
        const res = await fetch(`${apiBase}${path}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            let msg = '';
            try { msg = (await res.json()).message || ''; } catch { /* ignore */ }
            if (!msg) { try { msg = (await res.text()).slice(0, 240); } catch { /* ignore */ } }
            throw new Error(`${res.status} ${res.statusText} – ${msg || path}`);
        }
        return res.json();
    }

    // ======= UI base / topo =======
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

    // Navegação topo
    if (els.btnPrev) els.btnPrev.onclick = () => { state.date.setDate(state.date.getDate() - 1); refresh(); };
    if (els.btnNext) els.btnNext.onclick = () => { state.date.setDate(state.date.getDate() + 1); refresh(); };
    if (els.btnToday) els.btnToday.onclick = () => { state.date = new Date(); refresh(); };

    // Sidebar troca de view
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            showView(view);
        });
    });

    function showView(view) {
        // esconde secundárias com segurança
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
        start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // começa em segunda

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
        // admins veem todos; staff só o próprio
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

        // se admin e ainda não há seleção → “todos”
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
                    // de "todos" para apenas esse
                    state.selectedStaffIds = [s.id];
                } else {
                    const idx = state.selectedStaffIds.indexOf(s.id);
                    if (idx >= 0) state.selectedStaffIds.splice(idx, 1);
                    else state.selectedStaffIds.push(s.id);
                    if (state.selectedStaffIds.length === 0) {
                        // evitar estado "nenhum"
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
            if (state.selectedStaffIds.length === 0) {
                chipAll.classList.add('active');
            } else {
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

        const staffParam = state.selectedStaffIds.length === 1
            ? `&staffId=${encodeURIComponent(state.selectedStaffIds[0])}` : '';

        // (1) PRIORIDADE: /appointments?fromUtc&toUtc  ✅
        try {
            const url = `/appointments?fromUtc=${encodeURIComponent(startIsoUtc)}&toUtc=${encodeURIComponent(endIsoUtc)}${staffParam}`;
            const data = await apiGet(url);
            state.appts = normalizeAppts(data);
            return;
        } catch (_) { /* tenta o próximo */ }

        // (2) Por dia (se existir)
        try {
            const dateParam = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const data = await apiGet(`/appointments/day?date=${dateParam}${staffParam}`);
            state.appts = normalizeAppts(data);
            return;
        } catch (_) { /* tenta o próximo */ }

        // (3) /appointments/range?fromUtc&toUtc (alguns projetos usam /range)
        try {
            const data = await apiGet(`/appointments/range?fromUtc=${encodeURIComponent(startIsoUtc)}&toUtc=${encodeURIComponent(endIsoUtc)}${staffParam}`);
            state.appts = normalizeAppts(data);
            return;
        } catch (_) { /* tenta o próximo */ }

        // (4) Fallback legado: from/to (sem Utc)
        const data = await apiGet(`/appointments?from=${encodeURIComponent(startIsoUtc)}&to=${encodeURIComponent(endIsoUtc)}${staffParam}`);
        state.appts = normalizeAppts(data);
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
                color: staff?.color || '#7ee2b3'
            };
        });
    }

    // ======= Render grade do dia =======
    function renderDay() {
        if (!els.calendar) return;

        // header do dia
        const fmt = state.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
        if (els.dayTitle) els.dayTitle.textContent = fmt.replaceAll('.', '');
        if (els.openState) els.openState.textContent = ''; // futuro: status aberto/fechado

        els.dayTitle.textContent = fmt.replaceAll('.', '');

        // NOVO: preenche o chip interno
        const chipDate = document.getElementById('chipDate');
        const chipOpenState = document.getElementById('chipOpenState');
        if (chipDate) chipDate.textContent = els.dayTitle.textContent;

        // regra simples: sábado/domingo = fechado (ajuste depois pra regra real da empresa)
        const wd = state.date.getDay(); // 0 dom, 6 sáb
        const isOpen = !(wd === 0 || wd === 6);
        if (chipOpenState) chipOpenState.textContent = isOpen ? 'Aberto' : 'Fechado';
        if (els.openState) els.openState.textContent = isOpen ? 'Aberto' : 'Fechado';

        // estrutura base da grade
        const hoursCol = document.createElement('div');
        hoursCol.className = 'hours';
        for (let h = 7; h <= 20; h++) {
            const div = document.createElement('div');
            div.className = 'h';
            div.textContent = `${h.toString().padStart(2, '0')}:00`;
            hoursCol.appendChild(div);
        }

        const grid = document.createElement('div');
        grid.className = 'grid';

        const startMinutes = 7 * 60;
        const endMinutes = 20 * 60;
        const pxPerMinute = 80 / 60; // 80px por hora

        // linha do "agora" (se o dia é hoje)
        const now = new Date();
        if (now.toDateString() === state.date.toDateString()) {
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
            card.style.top = `${top}px`;
            card.style.height = `${height}px`;
            card.style.borderColor = `${a.color}`;
            card.innerHTML = `
        <div class="t">${pad(a.start)} — ${pad(a.end)}</div>
        <div class="s">${escapeHtml(a.client || '—')}${a.staffName ? ` • ${escapeHtml(a.staffName)}` : ''}</div>
      `;
            grid.appendChild(card);
        });

        els.calendar.innerHTML = '';
        els.calendar.appendChild(hoursCol);
        els.calendar.appendChild(grid);

        function pad(d) {
            return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
    }

    // ======= Team view simples =======
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

    // ======= refresh =======
    async function refresh(rebuildMini = true) {
        try {
            if (rebuildMini) renderMiniCal(state.date);
            if (!state.staff.length) await loadStaff();
            await loadAppointments();
            renderDay();
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
    }

    // ======= branding =======
    async function loadBranding() {
        try {
            const b = await apiGet(`/branding`);
            if (b.companyName && els.tenantName) els.tenantName.textContent = b.companyName;
            applyBranding(b.primaryColor, b.secondaryColor, b.tertiaryColor);
        } catch {
            applyBranding('#16a765', '#6dd8a9', '#0b2f21'); // defaults
        }
    }
    function applyBranding(primary, secondary, ink) {
        const root = document.documentElement;
        if (primary) root.style.setProperty('--primary', primary);
        if (secondary) root.style.setProperty('--primary-soft', secondary);
        if (ink) root.style.setProperty('--ink', ink);
    }

    // ======= INIT =======
    loadBranding()
        .finally(() => {
            renderMiniCal(state.date);
            refresh();
        });

})();
