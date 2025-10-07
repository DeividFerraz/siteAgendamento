// PATH: wwwroot/js/confi.js
// Regras:
//  - adm master: edita Empresa (branding + settings) OU um staff (foto + overrides). Vê FUSO.
//  - admin/staff: editam SOMENTE o próprio staff (foto + overrides). NÃO veem FUSO, nome da empresa, email do dono, trocar senha.

(function () {
    const token = localStorage.getItem('soren.token');
    const tenant = localStorage.getItem('soren.tenant_slug');
    const roleRaw = (localStorage.getItem('soren.role') || '').trim().toLowerCase();
    const myStaffId = localStorage.getItem('soren.staff_id') || null;

    const isMaster = roleRaw === 'adm master' || roleRaw === 'owner';
    const isAdmin = isMaster || roleRaw === 'admin';
    const canManageCompany = isMaster;

    if (!token || !tenant) return;

    const apiBaseTenant = `${window.location.origin}/api/v1/${encodeURIComponent(tenant)}`;
    const apiBaseRoot = `${window.location.origin}/api/v1`;

    // ---------- HTTP ----------
    async function safeErr(res, path) {
        try { const j = await res.json(); if (j?.message || j?.title) return `${res.status} ${res.statusText} – ${j.message || j.title}`; } catch { }
        try { const t = (await res.text()) || ''; return `${res.status} ${res.statusText} – ${t.slice(0, 240) || path}`; } catch { return `${res.status} ${res.statusText} – ${path}`; }
    }
    async function apiGetTenant(path) {
        const r = await fetch(`${apiBaseTenant}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(await safeErr(r, path));
        return r.json();
    }
    async function apiSendTenant(method, path, body) {
        const r = await fetch(`${apiBaseTenant}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!r.ok) throw new Error(await safeErr(r, path));
        return r.status === 204 ? null : r.json();
    }

    // ---------- UI helpers ----------
    const $ = (id) => document.getElementById(id);
    const hide = (el, flag) => { if (el) el.style.display = flag ? 'none' : ''; };

    // pega a <div class="settings-field"> que envolve o input/botão
    function rowOf(id) { const el = $(id); return el ? el.closest('.settings-field') : null; }

    // linhas (resolvidas após DOM pronto)
    let ROWS = {
        companyName: null,
        ownerEmail: null,
        logoOrPhoto: null,
        changePwd: null,
        timezone: null
    };

    // ---------- tempo ----------
    const hhmmFromMinutes = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    function buildTimeSelect(selectId, currentHHMM) {
        const sel = $(selectId); if (!sel) return;
        let html = '';
        for (let m = 0; m < 24 * 60; m += 5) { const lbl = hhmmFromMinutes(m); html += `<option value="${lbl}">${lbl}</option>`; }
        sel.innerHTML = html;
        if (currentHHMM) sel.value = currentHHMM;
    }

    // Dias ⇄ códigos
    const numToCode = { '0': 'SUN', '1': 'MON', '2': 'TUE', '3': 'WED', '4': 'THU', '5': 'FRI', '6': 'SAT' };
    const codeToNum = { SUN: '0', MON: '1', TUE: '2', WED: '3', THU: '4', FRI: '5', SAT: '6' };
    const ptToCode = { DOM: 'SUN', SEG: 'MON', TER: 'TUE', QUA: 'WED', QUI: 'THU', SEX: 'FRI', SAB: 'SAT', 'SÁB': 'SAT' };

    function normalizeDaysToCodes(days) {
        const out = new Set();
        (days || []).forEach(d => {
            const s = String(d || '').trim().toUpperCase();
            if (s in numToCode) out.add(numToCode[s]);
            else if (s in codeToNum) out.add(s);
            else if (s in ptToCode) out.add(ptToCode[s]);
        });
        return out;
    }
    function getCheckedDaysAsNumbers() {
        const out = [];
        document.querySelectorAll('.settings-days input[type="checkbox"][data-day]')
            .forEach(cb => { if (cb.checked) { const code = (cb.dataset.day || '').toUpperCase(); out.push(codeToNum[code] ?? code); } });
        return out;
    }

    // ---------- seletor alvo ----------
    let targetSelectEl = null;
    let currentTarget = canManageCompany ? { type: 'company', staffId: null }
        : { type: 'staff', staffId: myStaffId };

    async function buildTargetSelector() {
        const root = $('settingsView');
        if (!root || !canManageCompany) return;

        let row = $('settingsTargetRow');
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
        targetSelectEl = $('settingsTarget');

        // Empresa + staff
        let staff = [];
        try {
            const list = await apiGetTenant('/staff?active=true');
            staff = (list.items || list || []).map(s => ({
                id: s.id || s.Id || s.staffId || s.StaffId,
                name: s.displayName || s.DisplayName || s.name || s.Name
            }));
        } catch { }

        let options = `<option value="company">Empresa</option>`;
        options += staff.map(s => `<option value="${s.id}">Colaborador: ${s.name}</option>`).join('');
        targetSelectEl.innerHTML = options;

        targetSelectEl.value = currentTarget.type === 'company' ? 'company' : (currentTarget.staffId || '');
        targetSelectEl.onchange = () => {
            const v = targetSelectEl.value;
            currentTarget = (v === 'company') ? { type: 'company', staffId: null } : { type: 'staff', staffId: v };
            populateAll();
        };
    }

    // ---------- preenchimento ----------
    async function populateIdentity() {
        try {
            const s = await apiGetTenant('/settings');
            $('setCompanyName') && ($('setCompanyName').value = s.companyName || s.CompanyName || tenant);
            $('setTimezone') && ($('setTimezone').value = s.timezone || s.Timezone || 'America/Sao_Paulo');
        } catch { }
        try {
            const me = await fetch(`${apiBaseRoot}/me`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null);
            $('setOwnerEmail') && ($('setOwnerEmail').value = me?.user?.email || me?.user?.Email || '');
        } catch { }
    }

    async function populateBranding() {
        try {
            if (currentTarget.type === 'company') {
                const b = await apiGetTenant('/branding');
                $('setLogoUrl') && ($('setLogoUrl').value = b.logoUrl || b.LogoUrl || '');
            } else {
                const b = await apiGetTenant(`/staff/${encodeURIComponent(currentTarget.staffId)}/branding`);
                $('setLogoUrl') && ($('setLogoUrl').value = b.photoUrl || b.PhotoUrl || ''); // "" = herda
            }
        } catch { }
    }

    async function populateSchedule() {
        try {
            if (currentTarget.type === 'company') {
                const s = await apiGetTenant('/settings');
                buildTimeSelect('setOpenTime', s.openTime || s.OpenTime || '07:00');
                buildTimeSelect('setCloseTime', s.closeTime || s.CloseTime || '19:20');
                $('setSlotStep') && ($('setSlotStep').value = String(s.slotGranularityMinutes || s.SlotGranularityMinutes || 5));
                $('setDefaultLen') && ($('setDefaultLen').value = String(s.defaultAppointmentMinutes || s.DefaultAppointmentMinutes || 60));
                const codes = normalizeDaysToCodes(s.businessDays || s.BusinessDays || []);
                document.querySelectorAll('.settings-days input[type="checkbox"][data-day]')
                    .forEach(cb => cb.checked = codes.has((cb.dataset.day || '').toUpperCase()));
            } else {
                const s = await apiGetTenant(`/staff/${encodeURIComponent(currentTarget.staffId)}/settings`);
                buildTimeSelect('setOpenTime', s.openTime || '07:00');
                buildTimeSelect('setCloseTime', s.closeTime || '19:20');
                $('setSlotStep') && ($('setSlotStep').value = String(s.slotGranularityMinutes ?? 5));
                $('setDefaultLen') && ($('setDefaultLen').value = String(s.defaultAppointmentMinutes ?? 60));
                const codes = normalizeDaysToCodes(s.businessDays || []);
                document.querySelectorAll('.settings-days input[type="checkbox"][data-day]')
                    .forEach(cb => cb.checked = codes.has((cb.dataset.day || '').toUpperCase()));
            }
        } catch {
            buildTimeSelect('setOpenTime', '07:00');
            buildTimeSelect('setCloseTime', '19:20');
            $('setSlotStep') && ($('setSlotStep').value = '5');
            $('setDefaultLen') && ($('setDefaultLen').value = '60');
            document.querySelectorAll('.settings-days input[type="checkbox"][data-day]')
                .forEach(cb => cb.checked = ['MON', 'TUE', 'WED', 'THU', 'FRI'].includes((cb.dataset.day || '').toUpperCase()));
        }
    }

    function applyVisibilityByRole() {
        // Resolve as linhas (envoltórios) agora que o DOM está pronto
        ROWS.companyName = rowOf('setCompanyName');
        ROWS.ownerEmail = rowOf('setOwnerEmail');
        ROWS.logoOrPhoto = rowOf('setLogoUrl');
        ROWS.changePwd = rowOf('btnChangePassword');
        ROWS.timezone = rowOf('setTimezone');

        // Só adm master vê nome da empresa e email do dono
        hide(ROWS.companyName, !canManageCompany || currentTarget.type !== 'company');
        hide(ROWS.ownerEmail, !canManageCompany);

        // Fuso horário: apenas quando alvo = Empresa e adm master
        hide(ROWS.timezone, !(canManageCompany && currentTarget.type === 'company'));

        // Alterar senha: deixar apenas para adm master (ajuste se quiser liberar depois)
        hide(ROWS.changePwd, !canManageCompany);

        // Rótulo do campo de imagem
        const lbl = ROWS.logoOrPhoto ? ROWS.logoOrPhoto.querySelector('label') : null;
        if (lbl) {
            lbl.textContent = (currentTarget.type === 'company' && canManageCompany) ? 'Logo (URL)' :
                (isAdmin || !canManageCompany) ? 'Minha foto (URL)' : 'Foto (URL)';
        }
    }

    async function populateAll() {
        if (!canManageCompany) currentTarget = { type: 'staff', staffId: myStaffId };
        applyVisibilityByRole();
        await populateIdentity();
        await populateBranding();
        await populateSchedule();
    }

    // ---------- salvar ----------
    async function saveAll() {
        const logoUrl = ($('setLogoUrl') || {}).value || '';   // "" -> herdar
        const timezone = ($('setTimezone') || {}).value || '';   // só empresa
        const openTime = ($('setOpenTime') || {}).value || '07:00';
        const closeTime = ($('setCloseTime') || {}).value || '19:20';
        const slotStep = Number(($('setSlotStep') || {}).value || 5);
        const defLen = Number(($('setDefaultLen') || {}).value || 60);
        const days = getCheckedDaysAsNumbers();               // envia "0..6"

        try {
            if (currentTarget.type === 'company') {
                if (!canManageCompany) throw new Error('Sem permissão para alterar a empresa.');
                await apiSendTenant('PUT', '/branding', { LogoUrl: logoUrl || undefined });
                await apiSendTenant('PUT', '/settings', {
                    Timezone: timezone || undefined,
                    OpenTime: openTime,
                    CloseTime: closeTime,
                    SlotGranularityMinutes: isFinite(slotStep) ? slotStep : 5,
                    DefaultAppointmentMinutes: isFinite(defLen) ? defLen : 60,
                    BusinessDays: days
                });
            } else {
                if (!currentTarget.staffId) throw new Error('StaffId ausente.');
                // foto do colaborador
                await apiSendTenant('PUT', `/staff/${encodeURIComponent(currentTarget.staffId)}/branding`, { PhotoUrl: logoUrl });
                // overrides do colaborador (sem timezone)
                await apiSendTenant('PUT', `/staff/${encodeURIComponent(currentTarget.staffId)}/settings`, {
                    OpenTime: openTime,
                    CloseTime: closeTime,
                    SlotGranularityMinutes: isFinite(slotStep) ? slotStep : 5,
                    DefaultAppointmentMinutes: isFinite(defLen) ? defLen : 60,
                    BusinessDays: days
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
        const root = $('settingsView'); if (!root) return;

        // construir seletor Empresa/Staff apenas para adm master
        if (canManageCompany) buildTargetSelector().then(populateAll);
        else populateAll();

        const btnSave = $('btnSaveSettings');
        btnSave && btnSave.addEventListener('click', saveAll);

        const btnPwd = $('btnChangePassword');
        btnPwd && btnPwd.addEventListener('click', () => alert('Fluxo de troca de senha (somente adm master) – implementar depois.'));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
    else wire();
})();
