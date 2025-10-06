// PATH: wwwroot/js/confi.js
// Configurações:
//  - **Dono (owner)**: pode editar Empresa (/branding e /settings) e escolher um staff.
//  - **Admin normal e Colaborador**: SEMPRE editam **apenas** o próprio staff:
//      GET/PUT /staff/{id}/branding   (PhotoUrl pode ser vazio, herdando da empresa)
//      GET/PUT /staff/{id}/settings   (open/close, step, default, businessDays, timezone opcional)

(function () {
    const token = localStorage.getItem('soren.token');
    const tenant = localStorage.getItem('soren.tenant_slug');
    const role = (localStorage.getItem('soren.role') || '').toLowerCase();
    const myStaffId = localStorage.getItem('soren.staff_id') || null;

    const isOwner = role === 'owner';
    const isAdmin = role === 'owner' || role === 'admin';
    const canManageCompany = isOwner; // **apenas owner** usa rotas /branding e /settings do tenant

    if (!token || !tenant) return;

    const apiBaseTenant = `${window.location.origin}/api/v1/${encodeURIComponent(tenant)}`;
    const apiBaseRoot = `${window.location.origin}/api/v1`;

    // ---------- HTTP ----------
    async function apiGetTenant(path) {
        const res = await fetch(`${apiBaseTenant}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await safeErr(res, path));
        return res.json();
    }
    async function apiSendTenant(method, path, body) {
        const res = await fetch(`${apiBaseTenant}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) throw new Error(await safeErr(res, path));
        return res.status === 204 ? null : res.json();
    }
    async function safeErr(res, fallback) {
        try { const j = await res.json(); if (j && (j.message || j.title)) return `${res.status} ${res.statusText} – ${j.message || j.title}`; } catch { }
        try { return `${res.status} ${res.statusText} – ${(await res.text()).slice(0, 240) || fallback}`; } catch { return `${res.status} ${res.statusText} – ${fallback}`; }
    }

    // ---------- tempo ----------
    const hhmmFromMinutes = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    function buildTimeSelect(selectId, currentHHMM) {
        const sel = document.getElementById(selectId); if (!sel) return;
        let html = '';
        for (let m = 0; m < 24 * 60; m += 5) { const lbl = hhmmFromMinutes(m); html += `<option value="${lbl}">${lbl}</option>`; }
        sel.innerHTML = html;
        if (currentHHMM) sel.value = currentHHMM;
    }
    function getCheckedDays() {
        const days = [];
        document.querySelectorAll('.settings-days input[type="checkbox"]').forEach(cb => { if (cb.checked) days.push(cb.dataset.day); });
        return days;
    }

    // ---------- UI helpers ----------
    const byId = (id) => document.getElementById(id);
    const hide = (el, flag) => { if (el) el.style.display = flag ? 'none' : ''; };
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

    // ---------- seletor de alvo ----------
    let targetSelectEl = null;
    // Dono começa em "Empresa". Todos os outros: sempre staff (o próprio).
    let currentTarget = canManageCompany ? { type: 'company', staffId: null } : { type: 'staff', staffId: myStaffId };

    async function buildTargetSelector() {
        const root = document.getElementById('settingsView');
        if (!root || !canManageCompany) return; // admin normal/colaborador: não renderiza seletor

        let row = document.getElementById('settingsTargetRow');
        if (!row) {
            row = document.createElement('div');
            row.id = 'settingsTargetRow';
            row.className = 'settings-row';
            row.innerHTML = `
                <label>Editar configurações de:</label>
                <select id="settingsTarget"></select>
            `;
            root.prepend(row);
        }
        targetSelectEl = document.getElementById('settingsTarget');

        // opções do seletor
        let staff = [];
        try {
            const list = await apiGetTenant('/staff?active=true');
            staff = (list.items || list || []).map(s => ({
                id: s.id || s.Id || s.staffId || s.StaffId,
                name: s.displayName || s.DisplayName || s.name || s.Name
            }));
        } catch { }

        let options = `<option value="company">Empresa</option>`;
        options += staff.map(s => `<option value="${s.id}">Colaborador: ${escapeHtml(s.name)}</option>`).join('');
        targetSelectEl.innerHTML = options;

        targetSelectEl.value = currentTarget.type === 'company' ? 'company' : (currentTarget.staffId || '');
        targetSelectEl.onchange = () => {
            const v = targetSelectEl.value;
            currentTarget = (v === 'company') ? { type: 'company', staffId: null } : { type: 'staff', staffId: v };
            populateAll();
        };
    }

    // ---------- preenchimentos ----------
    async function populateIdentity() {
        // Identidade/Timezone da empresa (somente leitura para não-owner)
        try {
            const s = await apiGetTenant('/settings');
            const company = s.companyName || s.CompanyName || tenant;
            byId('setCompanyName') && (byId('setCompanyName').value = company);
            const tz = s.timezone || s.Timezone || '';
            byId('setTimezone') && (byId('setTimezone').value = tz);
        } catch { }
        // Email do dono (apenas informativo)
        try {
            const meRes = await fetch(`${apiBaseRoot}/me`, { headers: { Authorization: `Bearer ${token}` } });
            if (meRes.ok) {
                const me = await meRes.json();
                const email = me?.user?.email || me?.user?.Email || '';
                byId('setOwnerEmail') && (byId('setOwnerEmail').value = email);
            }
        } catch { }
    }

    async function populateBranding() {
        try {
            if (currentTarget.type === 'company') {
                const b = await apiGetTenant('/branding');
                const el = byId('setLogoUrl'); if (el) el.value = b.logoUrl || b.LogoUrl || '';
            } else {
                const b = await apiGetTenant(`/staff/${encodeURIComponent(currentTarget.staffId)}/branding`);
                const el = byId('setLogoUrl'); if (el) el.value = b.photoUrl || b.PhotoUrl || ''; // pode ser vazio
            }
        } catch { }
    }

    async function populateSchedule() {
        try {
            if (currentTarget.type === 'company') {
                const s = await apiGetTenant('/settings');
                buildTimeSelect('setOpenTime', s.openTime || s.OpenTime || '07:00');
                buildTimeSelect('setCloseTime', s.closeTime || s.CloseTime || '20:00');
                byId('setSlotStep') && (byId('setSlotStep').value = String(s.slotGranularityMinutes || s.SlotGranularityMinutes || 5));
                byId('setDefaultLen') && (byId('setDefaultLen').value = String(s.defaultAppointmentMinutes || s.DefaultAppointmentMinutes || 60));
                const days = (s.businessDays || s.BusinessDays || []);
                document.querySelectorAll('.settings-days input[type="checkbox"]').forEach(cb => cb.checked = days.includes(cb.dataset.day));
            } else {
                const s = await apiGetTenant(`/staff/${encodeURIComponent(currentTarget.staffId)}/settings`);
                buildTimeSelect('setOpenTime', s.openTime || '07:00');
                buildTimeSelect('setCloseTime', s.closeTime || '20:00');
                byId('setSlotStep') && (byId('setSlotStep').value = String(s.slotGranularityMinutes ?? 5));
                byId('setDefaultLen') && (byId('setDefaultLen').value = String(s.defaultAppointmentMinutes ?? 60));
                const days = (s.businessDays || []);
                document.querySelectorAll('.settings-days input[type="checkbox"]').forEach(cb => cb.checked = days.includes(cb.dataset.day));
            }
        } catch {
            // fallback básico
            buildTimeSelect('setOpenTime', '07:00');
            buildTimeSelect('setCloseTime', '20:00');
            byId('setSlotStep') && (byId('setSlotStep').value = '5');
            byId('setDefaultLen') && (byId('setDefaultLen').value = '60');
            document.querySelectorAll('.settings-days input[type="checkbox"]').forEach(cb => cb.checked = ['1', '2', '3', '4', '5'].includes(cb.dataset.day));
        }
    }

    async function populateAll() {
        // visibilidade por perfil
        hide(byId('rowCompanyName'), currentTarget.type !== 'company'); // só mostra nome empresa quando alvo=empresa
        hide(byId('rowOwnerEmail'), !canManageCompany);                 // só dono vê e-mail do dono
        hide(byId('rowTimezone'), currentTarget.type !== 'company'); // timezone exibido no modo empresa

        if (!canManageCompany) {
            // Admin normal / Colaborador: força o próprio staff
            currentTarget = { type: 'staff', staffId: myStaffId };
        }

        await populateIdentity();
        await populateBranding();
        await populateSchedule();
    }

    // ---------- salvar ----------
    async function saveAll() {
        const logoUrl = (byId('setLogoUrl') || {}).value || '';   // pode ser vazio -> herda
        const timezone = (byId('setTimezone') || {}).value || '';
        const openTime = (byId('setOpenTime') || {}).value || '07:00';
        const closeTime = (byId('setCloseTime') || {}).value || '20:00';
        const slotStep = Number((byId('setSlotStep') || {}).value || 5);
        const defLen = Number((byId('setDefaultLen') || {}).value || 60);
        const days = getCheckedDays();

        try {
            if (currentTarget.type === 'company') {
                if (!canManageCompany) throw new Error('Sem permissão para alterar a empresa.');
                await apiSendTenant('PUT', '/branding', { LogoUrl: logoUrl || undefined });
                await apiSendTenant('PUT', '/settings', {
                    SlotGranularityMinutes: slotStep,
                    Timezone: timezone || undefined,
                    BusinessDays: days,
                    OpenTime: openTime,
                    CloseTime: closeTime,
                    DefaultAppointmentMinutes: defLen
                });
            } else {
                if (!currentTarget.staffId) throw new Error('StaffId ausente.');
                // Branding (foto do colaborador). String vazia => limpa e herda da empresa
                await apiSendTenant('PUT', `/staff/${encodeURIComponent(currentTarget.staffId)}/branding`, { PhotoUrl: logoUrl });
                // Settings do colaborador
                await apiSendTenant('PUT', `/staff/${encodeURIComponent(currentTarget.staffId)}/settings`, {
                    SlotGranularityMinutes: slotStep,
                    BusinessDays: days,
                    OpenTime: openTime,
                    CloseTime: closeTime,
                    DefaultAppointmentMinutes: defLen
                    // Timezone por staff: se desejar, adicionar aqui (e liberar no backend)
                });
            }
        } catch (e) {
            console.error(e);
            alert('Não foi possível salvar as configurações.');
            return;
        }

        alert('Configurações salvas com sucesso.');
        location.reload();
    }

    // ---------- wire ----------
    function wire() {
        const root = document.getElementById('settingsView'); if (!root) return;

        // Dono vê seletor empresa/staff; demais não
        if (canManageCompany) buildTargetSelector().then(populateAll);
        else populateAll();

        const btnSave = document.getElementById('btnSaveSettings');
        btnSave && btnSave.addEventListener('click', saveAll);

        const btnPwd = document.getElementById('btnChangePassword');
        btnPwd && btnPwd.addEventListener('click', () => alert('Fluxo de troca de senha será implementado depois.'));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
    else wire();
})();
