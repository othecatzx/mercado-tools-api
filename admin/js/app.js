const API_URL = "http://localhost:3000";


// =========================
// SESSÃO
// =========================

const token = localStorage.getItem("admin_token");

if (!token) {
    window.location.href = "login.html";
}


// =========================
// ADMIN
// =========================

const adminUser = JSON.parse(
    localStorage.getItem("admin_user") || "{}"
);

const adminName =
    document.getElementById("adminName");

const adminEmail =
    document.getElementById("adminEmail");

const adminAvatar =
    document.getElementById("adminAvatar");

if (adminUser.nome) {
    adminName.textContent = adminUser.nome;

    adminAvatar.textContent =
        adminUser.nome.charAt(0).toUpperCase();
}

if (adminUser.email) {
    adminEmail.textContent = adminUser.email;
}


// =========================
// API
// =========================

async function apiFetch(url, options = {}) {

    const response = await fetch(
        `${API_URL}${url}`,
        {
            ...options,

            headers: {
                "Content-Type": "application/json",

                "Authorization": `Bearer ${token}`,

                ...(options.headers || {})
            }
        }
    );


    if (response.status === 401) {

        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_user");

        window.location.href = "login.html";

        return null;
    }


    return response;
}


// =========================
// DASHBOARD
// =========================

async function carregarDashboard() {
    const logsResponse = await apiFetch("/api/admin/logs");

if (logsResponse) {
    const logsData = await logsResponse.json();

    const logs = Array.isArray(logsData.logs)
        ? logsData.logs.slice(0, 10)
        : [];

    const recentActivityTable = document.getElementById(
        "recentActivityTable"
    );

    if (recentActivityTable) {
        if (logs.length === 0) {
            recentActivityTable.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center;">
                        Nenhuma atividade registrada.
                    </td>
                </tr>
            `;
        } else {
            recentActivityTable.innerHTML = logs.map(log => {

                const data = log.created_at
                    ? new Date(log.created_at).toLocaleString("pt-BR")
                    : "—";

                const acoes = {
    device_activated: "Dispositivo ativado",
    device_status_changed: "Status do dispositivo alterado",
    device_user_changed: "Usuário do dispositivo alterado",
    admin_login: "Login administrativo",
    license_activated: "Licença ativada",
    license_status_changed: "Status da licença alterado",
    company_created: "Empresa criada",
    company_updated: "Empresa atualizada",
    company_status_changed: "Status da empresa alterado",
    user_created: "Usuário criado",
    license_updated: "Licensa atualizada",
    user_updated: "Usuário atualizado",
    user_status_changed: "Status do usuário alterado",
    device_name_changed: "Nome do dispositivo alterado"
};

const acao = acoes[log.acao] || log.acao || "—";

                const empresa =
                    log.companies?.nome ||
                    "—";

                const dispositivo =
    log.acao === "device_name_changed"
        ? (log.detalhes?.new_name || "—")
        : (
            log.devices?.nome ||
            log.detalhes?.device_name ||
            log.devices?.device_id ||
            log.detalhes?.device_identifier ||
            "—"
        );

                return `
                    <tr>
                        <td>${data}</td>
                        <td>
    <span class="activity-badge">
        ${acao}
    </span>
</td>
                        <td>${empresa}</td>
                        <td>${dispositivo}</td>
                    </tr>
                `;
            }).join("");
        }
    }
}
    try {
        const [
            companiesResponse,
            licensesResponse,
            usersResponse,
            devicesResponse
        ] = await Promise.all([
            apiFetch("/api/admin/companies"),
            apiFetch("/api/admin/licenses"),
            apiFetch("/api/admin/users"),
            apiFetch("/api/admin/devices")
        ]);

        if (
            !companiesResponse ||
            !licensesResponse ||
            !usersResponse ||
            !devicesResponse
        ) {
            return;
        }

        const companies = await companiesResponse.json();
        const licenses = await licensesResponse.json();
        const users = await usersResponse.json();
        const devices = await devicesResponse.json();

        const companyList = Array.isArray(companies.companies)
            ? companies.companies
            : [];

        const licenseList = Array.isArray(licenses.licenses)
            ? licenses.licenses
            : [];

        const userList = Array.isArray(users.users)
            ? users.users
            : [];

        const deviceList = Array.isArray(devices.devices)
            ? devices.devices
            : [];

        const activeDevices = deviceList.filter(
            device => device.status === "active"
        ).length;

        const blockedDevices = deviceList.filter(
            device => device.status === "blocked"
        ).length;

        // Licenças vencendo nos próximos 30 dias
        const agora = new Date();
        const limite = new Date();
        limite.setDate(agora.getDate() + 30);

        const expiringLicenses = licenseList.filter(license => {
            if (!license.vencimento) {
                return false;
            }

            const vencimento = new Date(license.vencimento);

            return (
                vencimento >= agora &&
                vencimento <= limite &&
                license.status === "active"
            );
        }).length;

        const setCount = (id, value) => {
            const element = document.getElementById(id);

            if (element) {
                element.textContent = value;
            }
        };

        setCount("companiesCount", companyList.length);
        setCount("licensesCount", licenseList.length);
        setCount("usersCount", userList.length);
        setCount("devicesCount", deviceList.length);
        setCount("activeDevicesCount", activeDevices);
        setCount("blockedDevicesCount", blockedDevices);
        setCount("expiringLicensesCount", expiringLicenses);

        const expiringTable = document.getElementById(
    "expiringLicensesTable"
);

if (expiringTable) {
    const expiringList = licenseList
        .filter(license => {
            if (!license.vencimento) {
                return false;
            }

            const vencimento = new Date(license.vencimento);

            return (
                vencimento >= agora &&
                vencimento <= limite &&
                license.status === "active"
            );
        })
        .sort(
            (a, b) =>
                new Date(a.vencimento) -
                new Date(b.vencimento)
        );

    if (expiringList.length === 0) {
        expiringTable.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center;">
                    Nenhuma licença vencendo nos próximos 30 dias.
                </td>
            </tr>
        `;
    } else {
        expiringTable.innerHTML = expiringList
            .map(license => {
                const vencimento =
                    new Date(license.vencimento);

                const diffMs =
                    vencimento.getTime() -
                    agora.getTime();

                const diasRestantes =
                    Math.ceil(
                        diffMs /
                        (1000 * 60 * 60 * 24)
                    );

                const empresa =
                    license.companies?.nome ||
                    "Empresa não encontrada";

                return `
                    <tr>
                        <td>${empresa}</td>
                        <td>
    <div class="license-key-cell">
        <span
    class="license-key"
    data-license="${license.chave || ""}"
>
    ••••••••••••
</span>

        <button
    class="toggle-license"
    type="button"
    title="Mostrar licença"
>
    <span class="toggle-icon">◉</span>
    <span class="toggle-text">Mostrar</span>
</button>
    </div>
</td>
                        <td>
                            ${vencimento.toLocaleDateString("pt-BR")}
                        </td>
                        <td>
                            ${diasRestantes} dia${diasRestantes === 1 ? "" : "s"}
                        </td>
                    </tr>
                `;
            })
            .join("");
            expiringTable
    .querySelectorAll(".toggle-license")
    .forEach(button => {
        button.addEventListener("click", () => {
            const cell = button.closest(".license-key-cell");
            const key = cell.querySelector(".license-key");

            const license = key.dataset.license;

           if (key.textContent === license) {
    key.textContent = "••••••••••••";

    button.innerHTML = `
        <span class="toggle-icon">◉</span>
        <span class="toggle-text">Mostrar</span>
    `;

    button.title = "Mostrar licença";
} else {
    key.textContent = license;

    button.innerHTML = `
        <span class="toggle-icon">◉</span>
        <span class="toggle-text">Ocultar</span>
    `;

    button.title = "Ocultar licença";
}
        });
    });
    }
}

        console.log("Dashboard:", {
            empresas: companyList.length,
            licencas: licenseList.length,
            usuarios: userList.length,
            dispositivos: deviceList.length,
            ativos: activeDevices,
            bloqueados: blockedDevices,
            vencendo: expiringLicenses
        });

    } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
    }
}

// =========================
// NAVEGAÇÃO
// =========================

const pageTitles = {

    dashboard: {
        title: "Dashboard",
        description: "Visão geral do sistema"
    },

    companies: {
        title: "Empresas",
        description: "Gerencie as empresas cadastradas"
    },

    licenses: {
        title: "Licenças",
        description: "Gerencie as licenças do sistema"
    },

    users: {
        title: "Usuários",
        description: "Gerencie os usuários das empresas"
    },

    devices: {
        title: "Dispositivos",
        description: "Gerencie os dispositivos registrados"
    },

    logs: {
        title: "Logs",
        description: "Histórico de atividades do sistema"
    }

};


function navegar(page) {

    const info = pageTitles[page];

    if (!info) {
        return;
    }


    document.getElementById(
        "pageTitle"
    ).textContent = info.title;


    document.getElementById(
        "pageDescription"
    ).textContent = info.description;


    document.querySelectorAll(
        ".menu-item"
    ).forEach(button => {

        button.classList.toggle(
            "active",
            button.dataset.page === page
        );

    });


    if (page === "dashboard") {

        document.getElementById(
            "content"
        ).innerHTML = `

            <div id="dashboardPage">

                <div class="cards">

                    <div class="card">
                        <div class="card-icon">▣</div>

                        <div>
                            <span>Empresas</span>
                            <strong id="companiesCount">—</strong>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-icon">🔑</div>

                        <div>
                            <span>Licenças</span>
                            <strong id="licensesCount">—</strong>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-icon">♙</div>

                        <div>
                            <span>Usuários</span>
                            <strong id="usersCount">—</strong>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-icon">▤</div>

                        <div>
                            <span>Dispositivos</span>
                            <strong id="devicesCount">—</strong>
                        </div>
                    </div>

                    <div class="card">
    <div class="card-icon">✓</div>
    <div>
        <span>Navegadores ativos</span>
        <strong id="activeDevicesCount">—</strong>
    </div>
</div>

<div class="card">
    <div class="card-icon">!</div>
    <div>
        <span>Navegadores bloqueados</span>
        <strong id="blockedDevicesCount">—</strong>
    </div>
</div>

<div class="card">
    <div class="card-icon">⏳</div>
    <div>
        <span>Licenças vencendo</span>
        <strong id="expiringLicensesCount">—</strong>
    </div>
</div>

                </div>


                <div class="dashboard-grid">

                    <div class="panel">

                        <div class="panel-header">

                            <div>
                                <h2>Bem-vindo ao painel</h2>

                                <p>
                                    Gerencie empresas, licenças,
                                    usuários e dispositivos.
                                </p>
                            </div>

                        </div>


                        <div class="quick-actions">

                            <button
                                class="quick-action"
                                data-page="companies"
                            >
                                <span>▣</span>

                                <div>
                                    <strong>Empresas</strong>

                                    <small>
                                        Gerenciar clientes
                                    </small>
                                </div>
                            </button>


                            <button
                                class="quick-action"
                                data-page="licenses"
                            >
                                <span>🔑</span>

                                <div>
                                    <strong>Licenças</strong>

                                    <small>
                                        Gerenciar acessos
                                    </small>
                                </div>
                            </button>


                            <button
                                class="quick-action"
                                data-page="devices"
                            >
                                <span>▤</span>

                                <div>
                                    <strong>Dispositivos</strong>

                                    <small>
                                        Controlar dispositivos
                                    </small>
                                </div>
                            </button>

                        </div>

                    </div>


                    <div class="panel">

                        <div class="panel-header">

                            <div>
                                <h2>Status da API</h2>

                                <p>
                                    Conexão com o backend
                                </p>
                            </div>

                        </div>


                        <div class="api-status">

                            <div class="status-dot"></div>

                            <div>
                                <strong>
                                    API conectada
                                </strong>

                                <span>
                                    Servidor funcionando normalmente
                                </span>
                            </div>

                        </div>

                    </div>

                </div>

            </div>
        `;


        document.querySelectorAll(
            ".quick-action"
        ).forEach(button => {

            button.addEventListener(
                "click",
                () => navegar(button.dataset.page)
            );

        });


        carregarDashboard();

        return;
    }


    if (page === "companies") {

        companiesPage.render();

        return;
    }
    if (page === "licenses") {
    licensesPage.render();
    return;
}
if (page === "users") {
    usersPage.render();
    return;
}
if (page === "devices") {
    devicesPage.render();
    return;
}

    if (page === "logs") {

    logsPage.render();

    return;
}


    document.getElementById(
        "content"
    ).innerHTML = `

        <div class="panel">

            <div class="panel-header">

                <h2>${info.title}</h2>

                <p>
                    Esta seção será implementada
                    no próximo passo.
                </p>

            </div>

        </div>
    `;
}



// =========================
// BOTÕES DO MENU
// =========================

document.querySelectorAll(
    ".menu-item"
).forEach(button => {

    button.addEventListener(
        "click",
        () => navegar(button.dataset.page)
    );

});


// =========================
// AÇÕES RÁPIDAS
// =========================

document.querySelectorAll(
    ".quick-action"
).forEach(button => {

    button.addEventListener(
        "click",
        () => navegar(button.dataset.page)
    );

});


// =========================
// LOGOUT
// =========================

document.getElementById(
    "logoutButton"
).addEventListener(
    "click",
    () => {

        localStorage.removeItem(
            "admin_token"
        );

        localStorage.removeItem(
            "admin_user"
        );

        window.location.href =
            "login.html";
    }
);


// =========================
// INICIAR
// =========================

carregarDashboard();