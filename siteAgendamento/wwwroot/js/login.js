(function () {
    const form = document.getElementById('loginForm');
    const msg = document.getElementById('msg');
    const tenantInput = document.getElementById('tenant');

    // Pré-preenche a empresa com a última usada (se houver)
    const lastTenant = localStorage.getItem('soren.tenant_slug');
    if (lastTenant && !tenantInput.value) {
        tenantInput.value = lastTenant;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.className = 'msg';
        msg.textContent = 'Entrando...';

        let tenant = (tenantInput.value || '').trim().toLowerCase();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!tenant || !email || !password) {
            msg.className = 'msg error';
            msg.textContent = 'Informe empresa, e‑mail e senha.';
            return;
        }

        try {
            const res = await fetch(`${window.location.origin}/api/v1/${encodeURIComponent(tenant)}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `Falha no login (${res.status})`);
            }

            const data = await res.json();

            // Salva dados essenciais
            localStorage.setItem('soren.tenant_slug', tenant);
            localStorage.setItem('soren.token', data.access_token);
            localStorage.setItem('soren.role', data.role || '');
            localStorage.setItem('soren.staff_id', data.staff_id || '');
            localStorage.setItem('soren.tenant_id', data.tenant_id || '');

            msg.className = 'msg ok';
            msg.textContent = 'Login realizado com sucesso!';
            window.location.href = '/app.html';
        } catch (err) {
            msg.className = 'msg error';
            msg.textContent = (err && err.message) ? err.message : 'Erro inesperado no login.';
        }
    });
})();
