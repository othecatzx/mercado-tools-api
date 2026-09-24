const devicesPage = {


closeNameModal() {
    const modal = document.getElementById("deviceNameModal");

    if (modal) {
        modal.remove();
    }
},

async saveName(deviceId) {
    const input = document.getElementById("deviceNameInput");

    if (!input) return;

    const nome = input.value.trim();

    if (!nome) {
        alert("Digite um nome para o dispositivo.");
        input.focus();
        return;
    }

    try {
        const response = await apiFetch(
            `/api/admin/devices/${deviceId}/name`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    nome
                })
            }
        );

        if (!response) return;

        const data = await response.json();

        if (!response.ok || !data.ok) {
            throw new Error(
                data.error ||
                data.reason ||
                "Erro ao alterar nome"
            );
        }

        this.closeNameModal();

        await this.load();

        alert("Nome do dispositivo alterado com sucesso.");

    } catch (error) {
        console.error(error);
        alert(
            error.message ||
            "Não foi possível alterar o nome do dispositivo."
        );
    }
},

    devices: [],
    users: [],

    async render() {

        const content =
            document.getElementById("content");

        content.innerHTML = `

            <div class="page-toolbar">

                <div>

                    <h2>Dispositivos</h2>

                    <p>
                        Gerencie os dispositivos vinculados às empresas.
                    </p>

                </div>

                <div class="toolbar-actions">

                    <button
                        class="secondary-button"
                        id="refreshDevicesButton"
                    >
                        ↻ Atualizar
                    </button>

                </div>

            </div>


            <div class="panel">

                <div class="table-wrapper">

                    <table class="data-table">

                        <thead>

                            <tr>

                                <th>Dispositivo</th>
                                <th>Empresa</th>
                                <th>Usuário</th>
                                <th>Último acesso</th>
                                <th>Status</th>
                                <th>Ações</th>

                            </tr>

                        </thead>


                        <tbody id="devicesTableBody">

                            <tr>

                                <td
                                    colspan="6"
                                    class="loading"
                                >
                                    Carregando dispositivos...
                                </td>

                            </tr>

                        </tbody>

                    </table>

                </div>

            </div>

        `;


        document
            .getElementById("refreshDevicesButton")
            .addEventListener(
                "click",
                () => this.load()
            );


        await this.load();

    },


    async load() {

        const tbody =
            document.getElementById(
                "devicesTableBody"
            );

        if (!tbody) return;


        tbody.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    class="loading"
                >
                    Carregando dispositivos...
                </td>

            </tr>

        `;


        try {

            const response =
                await apiFetch(
                    "/api/admin/devices"
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao carregar dispositivos"
                );

            }


            this.devices =
                data.devices || [];


            this.renderTable();


        } catch (error) {

            console.error(error);


            tbody.innerHTML = `

                <tr>

                    <td
                        colspan="6"
                        class="error-cell"
                    >
                        Não foi possível carregar
                        os dispositivos.
                    </td>

                </tr>

            `;

        }

    },


    renderTable() {

        const tbody =
            document.getElementById(
                "devicesTableBody"
            );


        if (!this.devices.length) {

            tbody.innerHTML = `

                <tr>

                    <td
                        colspan="6"
                        class="empty-cell"
                    >
                        Nenhum dispositivo cadastrado.
                    </td>

                </tr>

            `;

            return;

        }


        tbody.innerHTML =
            this.devices.map(device => {

                const company =
                    device.companies?.nome ||
                    "—";


                const user =
                    device.users?.nome ||
                    "Sem usuário";


                const status =
                    this.formatStatus(
                        device.status
                    );


                const lastAccess =
                    this.formatDateTime(
                        device.ultimo_acesso
                    );


                return `

                    <tr>

                       <td>
    <strong>
        ${this.escape(
            device.nome ||
            device.device_id ||
            "Dispositivo"
        )}
    </strong>

    <div
        style="
            font-size:11px;
            color:#6b7280;
            margin-top:4px;
        "
    >
        ${this.escape(
            device.device_id ||
            "—"
        )}
    </div>

    <button
        class="secondary-button small"
        style="margin-top:6px;"
        onclick="devicesPage.openNameModal('${device.id}')"
    >
        Alterar nome
    </button>
</td>

                        <td>

                            ${this.escape(company)}

                        </td>


                        <td>

                            <div>

                                ${this.escape(user)}

                            </div>


                            <button
                                class="secondary-button small"
                                style="margin-top:6px;"
                                onclick="devicesPage.openUserModal('${device.id}')"
                            >

                                ${device.user_id
                                    ? "Alterar usuário"
                                    : "Vincular usuário"}

                            </button>

                        </td>


                        <td>

                            ${lastAccess}

                        </td>


                        <td>

                            ${status}

                        </td>


                        <td>

                            <div class="table-actions">

                                ${
                                    device.status === "active"

                                    ? `

                                        <button
                                            class="danger-button small"
                                            onclick="devicesPage.changeStatus('${device.id}', 'blocked')"
                                        >
                                            Bloquear
                                        </button>

                                        <button
                                            class="secondary-button small"
                                            onclick="devicesPage.removeDevice('${device.id}')"
                                        >
                                            Remover
                                        </button>

                                    `

                                    : device.status === "blocked"

                                    ? `

                                        <button
                                            class="success-button small"
                                            onclick="devicesPage.changeStatus('${device.id}', 'active')"
                                        >
                                            Ativar
                                        </button>

                                        <button
                                            class="secondary-button small"
                                            onclick="devicesPage.removeDevice('${device.id}')"
                                        >
                                            Remover
                                        </button>

                                    `

                                    : `

                                        <button
                                            class="success-button small"
                                            onclick="devicesPage.changeStatus('${device.id}', 'active')"
                                        >
                                            Reativar
                                        </button>

                                    `

                                }

                            </div>

                        </td>

                    </tr>

                `;

            }).join("");

    },


    async openUserModal(deviceId) {

        const device =
            this.devices.find(
                item => item.id === deviceId
            );


        if (!device) return;


        try {

            const response =
                await apiFetch(
                    "/api/admin/users"
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao carregar usuários"
                );

            }


            const users =
                (data.users || []).filter(
                    user =>
                        user.company_id ===
                        device.company_id &&
                        user.status === "active"
                );


            this.users = users;


            this.showUserModal(
                device,
                users
            );


        } catch (error) {

            console.error(error);

            alert(
                error.message ||
                "Não foi possível carregar os usuários."
            );

        }

    },


    showUserModal(device, users) {

        const existingModal =
            document.getElementById(
                "deviceUserModal"
            );


        if (existingModal) {

            existingModal.remove();

        }


        const currentUserId =
            device.user_id || "";


        const options = users.map(user => `

            <option
                value="${this.escape(user.id)}"
                ${
                    user.id === currentUserId
                        ? "selected"
                        : ""
                }
            >

                ${this.escape(user.nome)}
                —
                ${this.escape(user.email)}

            </option>

        `).join("");


        const modal = document.createElement("div");

        modal.id = "deviceUserModal";

        modal.className =
            "modal-overlay";


        modal.innerHTML = `

            <div class="modal">

                <div class="modal-header">

                    <div>

                        <h2>

                            Usuário do dispositivo

                        </h2>

                        <p>

                            ${this.escape(
                                device.nome ||
                                device.device_id
                            )}

                        </p>

                    </div>


                    <button
                        class="modal-close"
                        onclick="devicesPage.closeUserModal()"
                    >

                        ×

                    </button>

                </div>


                <form
                    id="deviceUserForm"
                >

                    <div class="form-group">

                        <label>

                            Usuário

                        </label>


                        <select
                            id="deviceUserSelect"
                        >

                            <option value="">

                                Sem usuário

                            </option>

                            ${options}

                        </select>

                    </div>


                    <div class="modal-footer">

                        <button
                            type="button"
                            class="secondary-button"
                            onclick="devicesPage.closeUserModal()"
                        >

                            Cancelar

                        </button>


                        <button
                            type="submit"
                            class="primary-button"
                        >

                            Salvar

                        </button>

                    </div>

                </form>

            </div>

        `;


        document.body.appendChild(modal);


        document
            .getElementById("deviceUserForm")
            .addEventListener(
                "submit",
                event => {

                    event.preventDefault();

                    this.saveUser(
                        device.id
                    );

                }
            );

    },


    closeUserModal() {

        const modal =
            document.getElementById(
                "deviceUserModal"
            );


        if (modal) {

            modal.remove();

        }

    },

    openNameModal(deviceId) {

    const device = this.devices.find(
        item => item.id === deviceId
    );

    if (!device) return;

    const existingModal =
        document.getElementById(
            "deviceNameModal"
        );

    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement("div");

    modal.id = "deviceNameModal";
    modal.className = "modal-overlay";

    modal.innerHTML = `
        <div class="modal">

            <div class="modal-header">

                <div>
                    <h2>
                        Alterar nome do dispositivo
                    </h2>

                    <p>
                        ${this.escape(
                            device.device_id
                        )}
                    </p>
                </div>

                <button
                    class="modal-close"
                    onclick="devicesPage.closeNameModal()"
                >
                    ×
                </button>

            </div>

            <form id="deviceNameForm">

                <div class="form-group">

                    <label>
                        Nome do dispositivo
                    </label>

                    <input
                        type="text"
                        id="deviceNameInput"
                        value="${this.escape(
                            device.nome || ""
                        )}"
                        maxlength="100"
                        required
                    >

                </div>

                <div class="modal-footer">

                    <button
                        type="button"
                        class="secondary-button"
                        onclick="devicesPage.closeNameModal()"
                    >
                        Cancelar
                    </button>

                    <button
                        type="submit"
                        class="primary-button"
                    >
                        Salvar
                    </button>

                </div>

            </form>

        </div>
    `;

    document.body.appendChild(modal);

    document
        .getElementById("deviceNameForm")
        .addEventListener("submit", event => {
            event.preventDefault();

            this.saveName(device.id);
        });

    document
        .getElementById("deviceNameInput")
        .focus();
},

closeNameModal() {

    const modal =
        document.getElementById(
            "deviceNameModal"
        );

    if (modal) {
        modal.remove();
    }
},

openNameModal(deviceId) {
    const device = this.devices.find(
        item => item.id === deviceId
    );

    if (!device) return;

    const existingModal =
        document.getElementById(
            "deviceNameModal"
        );

    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement("div");

    modal.id = "deviceNameModal";
    modal.className = "modal-overlay";

    modal.innerHTML = `
        <div class="modal">

            <div class="modal-header">
                <div>
                    <h2>
                        Alterar nome do dispositivo
                    </h2>

                    <p>
                        ${this.escape(
                            device.device_id
                        )}
                    </p>
                </div>

                <button
                    class="modal-close"
                    onclick="devicesPage.closeNameModal()"
                >
                    ×
                </button>
            </div>

            <form id="deviceNameForm">

                <div class="form-group">

                    <label>
                        Nome do dispositivo
                    </label>

                    <input
                        type="text"
                        id="deviceNameInput"
                        value="${this.escape(
                            device.nome || ""
                        )}"
                        maxlength="100"
                        required
                    >

                </div>

                <div class="modal-footer">

                    <button
                        type="button"
                        class="secondary-button"
                        onclick="devicesPage.closeNameModal()"
                    >
                        Cancelar
                    </button>

                    <button
                        type="submit"
                        class="primary-button"
                    >
                        Salvar
                    </button>

                </div>

            </form>

        </div>
    `;

    document.body.appendChild(modal);

    document
        .getElementById("deviceNameForm")
        .addEventListener("submit", event => {
            event.preventDefault();
            this.saveName(device.id);
        });

    document
        .getElementById("deviceNameInput")
        .focus();
},

closeNameModal() {
    const modal =
        document.getElementById(
            "deviceNameModal"
        );

    if (modal) {
        modal.remove();
    }
},

async saveName(deviceId) {
    const input =
        document.getElementById(
            "deviceNameInput"
        );

    if (!input) return;

    const nome =
        input.value.trim();

    if (!nome) {
        alert(
            "Digite um nome para o dispositivo."
        );
        return;
    }

    try {

        const response =
            await apiFetch(
                `/api/admin/devices/${deviceId}/name`,
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        nome
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok || !data.ok) {
            throw new Error(
                data.reason ||
                data.error ||
                "Erro ao alterar nome"
            );
        }

        this.closeNameModal();

        await this.load();

    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Não foi possível alterar o nome do dispositivo."
        );
    }
},

async saveName(deviceId) {

    const input =
        document.getElementById(
            "deviceNameInput"
        );

    if (!input) return;

    const nome =
        input.value.trim();

    if (!nome) {
        alert(
            "Digite um nome para o dispositivo."
        );
        return;
    }

    try {

        const response =
            await apiFetch(
                `/api/admin/devices/${deviceId}/name`,
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        nome
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok || !data.ok) {
            throw new Error(
                data.reason ||
                "Erro ao alterar nome"
            );
        }

        this.closeNameModal();

        await this.load();

    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Não foi possível alterar o nome do dispositivo."
        );
    }
},

    async saveUser(deviceId) {

        const select =
            document.getElementById(
                "deviceUserSelect"
            );


        if (!select) return;


        const userId =
            select.value || null;


        try {

            const response =
                await apiFetch(
                    `/api/admin/devices/${deviceId}/user`,
                    {
                        method: "PATCH",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            user_id: userId
                        })
                    }
                );


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao alterar usuário"
                );

            }


            this.closeUserModal();

            await this.load();


        } catch (error) {

            console.error(error);

            alert(
                error.message ||
                "Não foi possível alterar o usuário."
            );

        }

    },


    formatStatus(status) {

        const statuses = {

            active: `

                <span class="status-badge active">

                    Ativo

                </span>

            `,

            blocked: `

                <span class="status-badge blocked">

                    Bloqueado

                </span>

            `,

            removed: `

                <span class="status-badge inactive">

                    Removido

                </span>

            `

        };


        return statuses[status] || `

            <span class="status-badge">

                ${this.escape(status || "—")}

            </span>

        `;

    },


    formatDateTime(date) {

        if (!date) return "—";


        return new Date(date)
            .toLocaleString(
                "pt-BR",
                {
                    dateStyle: "short",
                    timeStyle: "short"
                }
            );

    },


    async removeDevice(id) {

    const device = this.devices.find(
        item => item.id === id
    );

    if (!device) return;

    const nome =
        device.nome ||
        device.device_id ||
        "este dispositivo";

    const confirmed = confirm(
        `Tem certeza que deseja remover "${nome}"?\n\n` +
        `O dispositivo será excluído permanentemente do banco de dados.\n\n` +
        `Essa ação não poderá ser desfeita.`
    );

    if (!confirmed) return;

    try {

        const response = await apiFetch(
            `/api/admin/devices/${id}`,
            {
                method: "DELETE"
            }
        );

        if (!response) return;

        const data = await response.json();

        if (!response.ok || !data.ok) {
            throw new Error(
                data.reason ||
                data.error ||
                "Erro ao remover dispositivo"
            );
        }

        await this.load();

        alert("Dispositivo removido com sucesso.");

    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Não foi possível remover o dispositivo."
        );
    }
},

async removeDevice(id) {

    const device = this.devices.find(
        item => item.id === id
    );

    if (!device) return;

    const nome =
        device.nome ||
        device.device_id ||
        "este dispositivo";

    const confirmed = confirm(
        `Tem certeza que deseja remover "${nome}"?\n\n` +
        `O dispositivo será excluído permanentemente do banco de dados.\n\n` +
        `Essa ação não poderá ser desfeita.`
    );

    if (!confirmed) return;

    try {

        const response = await apiFetch(
            `/api/admin/devices/${id}`,
            {
                method: "DELETE"
            }
        );

        if (!response) return;

        const data = await response.json();

        if (!response.ok || !data.ok) {
            throw new Error(
                data.reason ||
                data.error ||
                data.message ||
                "Erro ao remover dispositivo"
            );
        }

        await this.load();

        alert("Dispositivo removido com sucesso.");

    } catch (error) {

        console.error(
            "Erro ao remover dispositivo:",
            error
        );

        alert(
            error.message ||
            "Não foi possível remover o dispositivo."
        );
    }
},

    async changeStatus(id, status) {

        const device =
            this.devices.find(
                item => item.id === id
            );


        if (!device) return;


        let action;


        if (status === "blocked") {

            action = "bloquear";

        }

        else if (status === "active") {

            action = "ativar";

        }

        else {

            action = "remover";

        }


        const confirmed =
            confirm(
                `Deseja ${action} este dispositivo?`
            );


        if (!confirmed) return;


        try {

            const response =
                await apiFetch(
                    `/api/admin/devices/${id}/status`,
                    {
                        method: "PATCH",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            status
                        })

                    }
                );


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao alterar status"
                );

            }


            await this.load();


        } catch (error) {

            console.error(error);

            alert(
                error.message ||
                "Não foi possível alterar o status do dispositivo."
            );

        }

    },


    escape(value) {

        return String(value ?? "")

            .replace(/&/g, "&amp;")

            .replace(/</g, "&lt;")

            .replace(/>/g, "&gt;")

            .replace(/"/g, "&quot;")

            .replace(/'/g, "&#039;");

    }

};