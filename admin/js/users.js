const usersPage = {

    users: [],

    async render() {

        const content =
            document.getElementById("content");

        content.innerHTML = `

            <div class="page-toolbar">

                <div>
                    <h2>Usuários</h2>

                    <p>
                        Gerencie os usuários das empresas.
                    </p>
                </div>

                <div class="toolbar-actions">

                    <button
                        class="secondary-button"
                        id="refreshUsersButton"
                    >
                        ↻ Atualizar
                    </button>

                    <button
                        class="primary-button"
                        id="newUserButton"
                    >
                        + Novo usuário
                    </button>

                </div>

            </div>


            <div class="panel">

                <div class="table-wrapper">

                    <table class="data-table">

                        <thead>

                            <tr>
                                <th>Nome</th>
                                <th>E-mail</th>
                                <th>Empresa</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>

                        </thead>


                        <tbody id="usersTableBody">

                            <tr>

                                <td
                                    colspan="5"
                                    class="loading"
                                >
                                    Carregando usuários...
                                </td>

                            </tr>

                        </tbody>

                    </table>

                </div>

            </div>
        `;


        document
            .getElementById("refreshUsersButton")
            .addEventListener(
                "click",
                () => this.load()
            );


        document
            .getElementById("newUserButton")
            .addEventListener(
                "click",
                () => this.showCreateModal()
            );


        await this.load();
    },


    async load() {

        const tbody =
            document.getElementById(
                "usersTableBody"
            );

        if (!tbody) return;


        tbody.innerHTML = `
            <tr>
                <td
                    colspan="5"
                    class="loading"
                >
                    Carregando usuários...
                </td>
            </tr>
        `;


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


            this.users =
                data.users || [];


            this.renderTable();


        } catch (error) {

            console.error(error);


            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="5"
                        class="error-cell"
                    >
                        Não foi possível carregar
                        os usuários.
                    </td>
                </tr>
            `;
        }
    },


    renderTable() {

        const tbody =
            document.getElementById(
                "usersTableBody"
            );


        if (!this.users.length) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="5"
                        class="empty-cell"
                    >
                        Nenhum usuário cadastrado.
                    </td>
                </tr>
            `;

            return;
        }


        tbody.innerHTML =
            this.users.map(user => {

                const company =
                    user.companies?.nome ||
                    "—";


                const status =
                    this.formatStatus(
                        user.status
                    );


                return `

                    <tr>

                        <td>
                            <strong>
                                ${this.escape(
                                    user.nome
                                )}
                            </strong>
                        </td>


                        <td>
                            ${this.escape(
                                user.email
                            )}
                        </td>


                        <td>
                            ${this.escape(
                                company
                            )}
                        </td>


                        <td>
                            ${status}
                        </td>


                        <td>

                            <div class="table-actions">

                                <button
                                    class="secondary-button small"
                                    onclick="usersPage.editUser('${user.id}')"
                                >
                                    Editar
                                </button>


                                ${
                                    user.status === "active"

                                    ? `
                                        <button
                                            class="danger-button small"
                                            onclick="usersPage.changeStatus('${user.id}', 'blocked')"
                                        >
                                            Bloquear
                                        </button>
                                    `

                                    : `
                                        <button
                                            class="success-button small"
                                            onclick="usersPage.changeStatus('${user.id}', 'active')"
                                        >
                                            Ativar
                                        </button>
                                    `
                                }

                            </div>

                        </td>

                    </tr>

                `;

            }).join("");
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

            inactive: `
                <span class="status-badge inactive">
                    Inativo
                </span>
            `
        };


        return statuses[status] || `
            <span class="status-badge">
                ${this.escape(status || "—")}
            </span>
        `;
    },


    async changeStatus(id, status) {

        const user =
            this.users.find(
                item => item.id === id
            );


        if (!user) return;


        const action =
            status === "active"
                ? "ativar"
                : "bloquear";


        if (
            !confirm(
                `Deseja ${action} este usuário?`
            )
        ) {
            return;
        }


        try {

            const response =
                await apiFetch(
                    `/api/admin/users/${id}/status`,
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
                "Não foi possível alterar o status do usuário."
            );
        }
    },


    async showCreateModal() {

        try {

            const response =
                await apiFetch(
                    "/api/admin/companies"
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao carregar empresas"
                );
            }


            const companies =
                data.companies || [];


            const activeCompanies =
                companies.filter(
                    company =>
                        company.status === "active"
                );


            if (!activeCompanies.length) {

                alert(
                    "Não existem empresas ativas cadastradas."
                );

                return;
            }


            const modal =
                document.createElement("div");


            modal.className =
                "modal-overlay";


            modal.innerHTML = `

                <div class="modal">

                    <div class="modal-header">

                        <div>

                            <h2>
                                Novo usuário
                            </h2>

                            <p>
                                Cadastre um usuário
                                para uma empresa.
                            </p>

                        </div>


                        <button
                            class="modal-close"
                            id="closeUserModal"
                        >
                            ×
                        </button>

                    </div>


                    <form id="createUserForm">

                        <div class="form-group">

                            <label>
                                Empresa
                            </label>

                            <select
                                id="userCompany"
                                required
                            >

                                <option value="">
                                    Selecione uma empresa
                                </option>

                                ${activeCompanies
                                    .map(company => `
                                        <option
                                            value="${company.id}"
                                        >
                                            ${this.escape(
                                                company.nome
                                            )}
                                        </option>
                                    `)
                                    .join("")
                                }

                            </select>

                        </div>


                        <div class="form-group">

                            <label>
                                Nome
                            </label>

                            <input
                                type="text"
                                id="userName"
                                placeholder="Nome do usuário"
                                required
                            >

                        </div>


                        <div class="form-group">

                            <label>
                                E-mail
                            </label>

                            <input
                                type="email"
                                id="userEmail"
                                placeholder="usuario@empresa.com"
                                required
                            >

                        </div>


                        <div class="modal-footer">

                            <button
                                type="button"
                                class="secondary-button"
                                id="cancelUserModal"
                            >
                                Cancelar
                            </button>


                            <button
                                type="submit"
                                class="primary-button"
                            >
                                Criar usuário
                            </button>

                        </div>

                    </form>

                </div>
            `;


            document.body.appendChild(modal);


            document
                .getElementById("closeUserModal")
                .addEventListener(
                    "click",
                    () => modal.remove()
                );


            document
                .getElementById("cancelUserModal")
                .addEventListener(
                    "click",
                    () => modal.remove()
                );


            document
                .getElementById("createUserForm")
                .addEventListener(
                    "submit",
                    async event => {

                        event.preventDefault();

                        await this.createUser(
                            modal
                        );
                    }
                );


        } catch (error) {

            console.error(error);

            alert(
                "Não foi possível carregar as empresas."
            );
        }
    },


    async createUser(modal) {

        const company_id =
            document
                .getElementById("userCompany")
                .value;


        const nome =
            document
                .getElementById("userName")
                .value
                .trim();


        const email =
            document
                .getElementById("userEmail")
                .value
                .trim()
                .toLowerCase();


        if (
            !company_id ||
            !nome ||
            !email
        ) {

            alert(
                "Preencha todos os campos."
            );

            return;
        }


        try {

            const response =
                await apiFetch(
                    "/api/admin/users",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            company_id,
                            nome,
                            email
                        })
                    }
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao criar usuário"
                );
            }


            modal.remove();


            await this.load();


            alert(
                "Usuário criado com sucesso!"
            );


        } catch (error) {

            console.error(error);

            alert(
                error.message ||
                "Não foi possível criar o usuário."
            );
        }
    },


    async editUser(id) {

        const user =
            this.users.find(
                item => item.id === id
            );


        if (!user) return;


        const modal =
            document.createElement("div");


        modal.className =
            "modal-overlay";


        modal.innerHTML = `

            <div class="modal">

                <div class="modal-header">

                    <div>

                        <h2>
                            Editar usuário
                        </h2>

                        <p>
                            Altere os dados do usuário.
                        </p>

                    </div>


                    <button
                        class="modal-close"
                        id="closeEditUserModal"
                    >
                        ×
                    </button>

                </div>


                <form id="editUserForm">

                    <div class="form-group">

                        <label>
                            Empresa
                        </label>

                        <input
                            type="text"
                            value="${this.escape(
                                user.companies?.nome ||
                                "Sem empresa"
                            )}"
                            disabled
                        >

                    </div>


                    <div class="form-group">

                        <label>
                            Nome
                        </label>

                        <input
                            type="text"
                            id="editUserName"
                            value="${this.escape(
                                user.nome
                            )}"
                            required
                        >

                    </div>


                    <div class="form-group">

                        <label>
                            E-mail
                        </label>

                        <input
                            type="email"
                            id="editUserEmail"
                            value="${this.escape(
                                user.email
                            )}"
                            required
                        >

                    </div>


                    <div class="modal-footer">

                        <button
                            type="button"
                            class="secondary-button"
                            id="cancelEditUserModal"
                        >
                            Cancelar
                        </button>


                        <button
                            type="submit"
                            class="primary-button"
                        >
                            Salvar alterações
                        </button>

                    </div>

                </form>

            </div>
        `;


        document.body.appendChild(modal);


        document
            .getElementById("closeEditUserModal")
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById("cancelEditUserModal")
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById("editUserForm")
            .addEventListener(
                "submit",
                async event => {

                    event.preventDefault();

                    await this.updateUser(
                        id,
                        modal
                    );
                }
            );
    },


    async updateUser(id, modal) {

        const nome =
            document
                .getElementById("editUserName")
                .value
                .trim();


        const email =
            document
                .getElementById("editUserEmail")
                .value
                .trim()
                .toLowerCase();


        if (!nome || !email) {

            alert(
                "Preencha todos os campos."
            );

            return;
        }


        try {

            const response =
                await apiFetch(
                    `/api/admin/users/${id}`,
                    {
                        method: "PUT",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            nome,
                            email
                        })
                    }
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao atualizar usuário"
                );
            }


            modal.remove();


            await this.load();


            alert(
                "Usuário atualizado com sucesso!"
            );


        } catch (error) {

            console.error(error);

            alert(
                error.message ||
                "Não foi possível atualizar o usuário."
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