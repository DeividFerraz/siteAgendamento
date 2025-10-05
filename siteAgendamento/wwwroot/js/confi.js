// PATH: wwwroot/js/confi.js
// Painel de Configurações (isolado do app.js)
// - Não depende de variáveis internas do app.js (que estão em IIFE).
// - Após salvar, força reload da página para o app.js reler /settings e /branding.

(function () {
    const token = localStorage.getItem('soren.token');
    const tenant = localStorage.getItem('soren.tenant_slug');

    if (!token || !tenant) return; // sem sessão, não faz nada

    const apiBaseTenant = `${window.location.origin}/api/v1/${encodeURIComponent(tenant)}`;
    const apiBaseRoot = `${window.location.origin}/api/v1`;

    // ------------- helpers HTTP -------------
    async function apiGetTenant(path) {
        const res = await fetch(`${apiBaseTenant}${path}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await safeErr(res, path));
        return res.json();
    }
    async function apiGetRoot(path) {
        const res = await fetch(`${apiBaseRoot}${path}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await safeErr(res, path));
        return res.json();
    }
    async function apiPutTenant(path, body) {
        const res = await fetch(`${apiBaseTenant}${path}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body || {})
        });
        if (!res.ok) throw new Error(await safeErr(res, path));
        return res.json();
    }
    async function safeErr(res, fallback) {
        try {
            const j = await res.json();
            if (j && (j.message || j.title)) return `${res.status} ${res.statusText} – ${j.message || j.title}`;
        } catch { }
        try { return `${res.status} ${res.statusText} – ${(await res.text()).slice(0, 240) || fallback}`; }
        catch { return `${res.status} ${res.statusText} – ${fallback}`; }
    }

    // ------------- helpers tempo -------------
    function hhmmFromMinutes(min) {
        const h = String(Math.floor(min / 60)).padStart(2, '0');
        const m = String(min % 60).padStart(2, '0');
        return `${h}:${m}`;
    }
    function minutesFromHHMM(hhmm) {
        const [h, m] = String(hhmm || '00:00').split(':').map(Number);
        return (h * 60) + (m || 0);
    }
    function buildTimeSelect(selectId, currentHHMM) {
        const sel = document.getElementById(selectId); if (!sel) return;
        let html = '';
        // 5 em 5 para seleção confortável; backend aceita HH:mm
        for (let m = 0; m < 24 * 60; m += 5) {
            const lbl = hhmmFromMinutes(m);
            html += `<option value="${lbl}">${lbl}</option>`;
        }
        sel.innerHTML = html;
        if (currentHHMM) sel.value = currentHHMM;
    }
    function getCheckedDays() {
        const days = [];
        document.querySelectorAll('.settings-days input[type="checkbox"]').forEach(cb => {
            if (cb.checked) days.push(cb.dataset.day);
        });
        return days;
    }

    // ------------- preencher UI -------------
    async function populateIdentity() {
        // nome da empresa (via settings) e e-mail (via /me global)
        try {
            const s = await apiGetTenant('/settings');
            const company = s.companyName || s.CompanyName || tenant;
            const elName = byId('setCompanyName'); if (elName) elName.value = company;
            const tz = s.timezone || s.Timezone || '';
            const elTz = byId('setTimezone'); if (elTz) elTz.value = tz;
        } catch { }

        try {
            // /api/v1/me (sem tenantSlug no path)
            const me = await apiGetRoot('/me');
            const email = me?.user?.email || me?.user?.Email || '';
            const elEmail = byId('setOwnerEmail'); if (elEmail) elEmail.value = email;
        } catch { }
    }

    async function populateBranding() {
        try {
            const b = await apiGetTenant('/branding');
            const el = byId('setLogoUrl');
            if (el) el.value = b.logoUrl || b.LogoUrl || '';
        } catch { }
    }

    async function populateSchedule() {
        try {
            const s = await apiGetTenant('/settings');

            const openHH = s.openTime || s.OpenTime || '07:00';
            const closeHH = s.closeTime || s.CloseTime || '20:00';
            buildTimeSelect('setOpenTime', openHH);
            buildTimeSelect('setCloseTime', closeHH);

            const step = s.slotGranularityMinutes || s.SlotGranularityMinutes || 5;
            const def = s.defaultAppointmentMinutes || s.DefaultAppointmentMinutes || 60;
            if (byId('setSlotStep')) byId('setSlotStep').value = String(step);
            if (byId('setDefaultLen')) byId('setDefaultLen').value = String(def);

            const days = (s.businessDays || s.BusinessDays || []);
            document.querySelectorAll('.settings-days input[type="checkbox"]').forEach(cb => {
                cb.checked = days.includes(cb.dataset.day);
            });
        } catch { }
    }

    // ------------- salvar -------------
    async function saveAll() {
        const logoUrl = (byId('setLogoUrl') || {}).value || null;
        const timezone = (byId('setTimezone') || {}).value || '';
        const openTime = (byId('setOpenTime') || {}).value || '07:00';
        const closeTime = (byId('setCloseTime') || {}).value || '20:00';
        const slotStep = Number((byId('setSlotStep') || {}).value || 5);
        const defLen = Number((byId('setDefaultLen') || {}).value || 60);
        const days = getCheckedDays();

        // PUT branding (logo opcional)
        try {
            await apiPutTenant('/branding', {
                LogoUrl: logoUrl || undefined
            });
        } catch (e) {
            console.warn('Falha ao salvar branding', e);
            alert('Não foi possível salvar o Branding (logo).');
            return;
        }

        // PUT settings (campos novos preservados no DTO extendido)
        try {
            await apiPutTenant('/settings', {
                SlotGranularityMinutes: slotStep,
                Timezone: timezone || undefined,
                BusinessDays: days,
                OpenTime: openTime,
                CloseTime: closeTime,
                DefaultAppointmentMinutes: defLen
            });
        } catch (e) {
            console.error(e);
            alert('Não foi possível salvar os Horários/Configurações.');
            return;
        }

        // recarrega a aplicação para a agenda reler /settings e aplicar WORK_START/END
        alert('Configurações salvas com sucesso.');
        location.reload();
    }

    // ------------- wire -------------
    function wire() {
        // se não houver view de settings, não faz nada
        const root = document.getElementById('settingsView');
        if (!root) return;

        const btnSave = document.getElementById('btnSaveSettings');
        if (btnSave) btnSave.addEventListener('click', saveAll);

        const btnPwd = document.getElementById('btnChangePassword');
        if (btnPwd) btnPwd.addEventListener('click', () => {
            alert('Fluxo de troca de senha será implementado depois.');
        });

        // popular UI
        populateIdentity();
        populateBranding();
        populateSchedule();
    }

    function byId(id) { return document.getElementById(id); }

    // dispara quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire, { once: true });
    } else {
        wire();
    }
})();
