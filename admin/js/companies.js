const companiesPage = {

    companies: [],

    async render() {

        const content = document.getElementById("content");

        content.innerHTML = `
            <div class="page-toolbar">

                <div>
                    <h2>Empresas</h2>
                    <p>Gerencie as empresas cadastradas no sistema.</p>
                </div>

                <button class="primary-button" id="newCompanyButton">
                    + Nova empresa
                </button>

            </div>

            <div class="panel">

                <div class="table-wrapper">

                    <table class="data-table">

                        <thead>
                            <tr>
                                <th>Empresa</th>
                                <th>Documento</th>
                                <th>Status</th>
                                <th>Criada em</th>
                                <th>Ações</th>
                            </tr>
                        </thead>

                        <tbody id="companiesTableBody">

                            <tr>
                                <td colspan="5" class="loading">
                                    Carregando empresas...
                                </td>
                            </tr>

                        </tbody>

                    </table>

                </div>

            </div>
        `;

        document
            .getElementById("newCompanyButton")
            .addEventListener("click", () => {
                this.openModal();
            });

        await this.load();
    },


    async load() {

        try {

            const response =
                await apiFetch("/api/admin/companies");

            if (!response) return;

            const data =
                await response.json();

            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason || "Erro ao carregar empresas"
                );

            }

            this.companies = data.companies || [];

            this.renderTable();

        } catch (error) {

            console.error(error);

            const tbody =
                document.getElementById(
                    "companiesTableBody"
                );

            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="error-cell">
                        Não foi possível carregar as empresas.
                    </td>
                </tr>
            `;
        }
    },


    renderTable() {

        const tbody =
            document.getElementById(
                "companiesTableBody"
            );

        if (!this.companies.length) {

            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-cell">
                        Nenhuma empresa cadastrada.
                    </td>
                </tr>
            `;

            return;
        }


        tbody.innerHTML =
            this.companies.map(company => {

                const statusClass =
                    company.status === "active"
                        ? "status-active"
                        : company.status === "blocked"
                            ? "status-blocked"
                            : "status-inactive";


                const statusText =
                    company.status === "active"
                        ? "Ativa"
                        : company.status === "blocked"
                            ? "Bloqueada"
                            : "Inativa";


                const createdAt =
                    company.created_at
                        ? new Date(
                            company.created_at
                        ).toLocaleDateString(
                            "pt-BR"
                        )
                        : "—";


                const actionText =
                    company.status === "active"
                        ? "Bloquear"
                        : "Ativar";


                return `

                    <tr>

                        <td>

                            <div class="company-name">
                                <strong>
                                    ${this.escape(company.nome)}
                                </strong>

                                <small>
                                    ${company.id}
                                </small>
                            </div>

                        </td>


                        <td>
                            ${this.escape(
                                company.documento || "—"
                            )}
                        </td>


                        <td>

                            <span class="status ${statusClass}">
                                ${statusText}
                            </span>

                        </td>


                        <td>
                            ${createdAt}
                        </td>


                        <td>

                            <div class="table-actions">

                                <button
                                    class="action-button"
                                    onclick="companiesPage.openEdit('${company.id}')"
                                >
                                    Editar
                                </button>

                                <button
                                    class="action-button ${
                                        company.status === "active"
                                            ? "danger"
                                            : "success"
                                    }"
                                    onclick="companiesPage.changeStatus(
                                        '${company.id}',
                                        '${company.status}'
                                    )"
                                >
                                    ${actionText}
                                </button>

                            </div>

                        </td>

                    </tr>

                `;

            }).join("");
    },


    openModal(company = null) {

        const isEdit = !!company;

        const modal =
            document.createElement("div");

        modal.className = "modal-overlay";

        modal.id = "companyModal";


        modal.innerHTML = `

            <div class="modal">

                <div class="modal-header">

                    <div>
                        <h2>
                            ${isEdit
                                ? "Editar empresa"
                                : "Nova empresa"}
                        </h2>

                        <p>
                            ${isEdit
                                ? "Atualize os dados da empresa."
                                : "Cadastre uma nova empresa."}
                        </p>
                    </div>

                    <button
                        class="modal-close"
                        id="closeCompanyModal"
                    >
                        ×
                    </button>

                </div>


                <form id="companyForm">

                    <div class="form-group">

                        <label for="companyName">
                            Nome da empresa
                        </label>

                        <input
                            type="text"
                            id="companyName"
                            required
                            maxlength="150"
                            value="${
                                isEdit
                                    ? this.escape(company.nome)
                                    : ""
                            }"
                            placeholder="Ex.: 4SHOW Comércio de Eletrônicos"
                        >

                    </div>


                    <div class="form-group">

                        <label for="companyDocument">
                            CNPJ / Documento
                        </label>

                        <input
                            type="text"
                            id="companyDocument"
                            maxlength="30"
                            value="${
                                isEdit
                                    ? this.escape(
                                        company.documento || ""
                                    )
                                    : ""
                            }"
                            placeholder="Ex.: 12345678000100"
                        >

                    </div>


                    <div id="companyFormStatus"></div>


                    <div class="modal-footer">

                        <button
                            type="button"
                            class="secondary-button"
                            id="cancelCompanyButton"
                        >
                            Cancelar
                        </button>

                        <button
                            type="submit"
                            class="primary-button"
                            id="saveCompanyButton"
                        >
                            ${isEdit ? "Salvar alterações" : "Criar empresa"}
                        </button>

                    </div>

                </form>

            </div>

        `;


        document.body.appendChild(modal);


        document
            .getElementById("closeCompanyModal")
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById("cancelCompanyButton")
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById("companyForm")
            .addEventListener(
                "submit",
                async event => {

                    event.preventDefault();

                    if (isEdit) {

                        await this.update(
                            company.id,
                            modal
                        );

                    } else {

                        await this.create(modal);

                    }

                }
            );
    },


    openEdit(id) {

        const company =
            this.companies.find(
                item => item.id === id
            );

        if (!company) return;

        this.openModal(company);
    },


    async create(modal) {

        const nome =
            document
                .getElementById("companyName")
                .value
                .trim();


        const documento =
            document
                .getElementById("companyDocument")
                .value
                .trim();


        const status =
            document.getElementById(
                "companyFormStatus"
            );


        if (!nome) {

            status.innerHTML = `
                <div class="form-error">
                    Informe o nome da empresa.
                </div>
            `;

            return;
        }


        const button =
            document.getElementById(
                "saveCompanyButton"
            );

        button.disabled = true;
        button.textContent = "Criando...";


        try {

            const response =
                await apiFetch(
                    "/api/admin/companies",
                    {
                        method: "POST",

                        body: JSON.stringify({
                            nome,
                            documento
                        })
                    }
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao criar empresa"
                );

            }


            modal.remove();

            await this.load();

            carregarDashboard();


        } catch (error) {

            console.error(error);

            status.innerHTML = `
                <div class="form-error">
                    ${this.escape(
                        error.message
                    )}
                </div>
            `;

        } finally {

            button.disabled = false;
            button.textContent = "Criar empresa";
        }
    },


    async update(id, modal) {

        const nome =
            document
                .getElementById("companyName")
                .value
                .trim();


        const documento =
            document
                .getElementById("companyDocument")
                .value
                .trim();


        const status =
            document.getElementById(
                "companyFormStatus"
            );


        if (!nome) {

            status.innerHTML = `
                <div class="form-error">
                    Informe o nome da empresa.
                </div>
            `;

            return;
        }


        const button =
            document.getElementById(
                "saveCompanyButton"
            );

        button.disabled = true;
        button.textContent = "Salvando...";


        try {

            const response =
                await apiFetch(
                    `/api/admin/companies/${id}`,
                    {
                        method: "PUT",

                        body: JSON.stringify({
                            nome,
                            documento
                        })
                    }
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao atualizar empresa"
                );

            }


            modal.remove();

            await this.load();

            carregarDashboard();


        } catch (error) {

            console.error(error);

            status.innerHTML = `
                <div class="form-error">
                    ${this.escape(
                        error.message
                    )}
                </div>
            `;

        } finally {

            button.disabled = false;
            button.textContent =
                "Salvar alterações";
        }
    },


    async changeStatus(id, currentStatus) {

        const newStatus =
            currentStatus === "active"
                ? "blocked"
                : "active";


        const company =
            this.companies.find(
                item => item.id === id
            );


        const action =
            newStatus === "blocked"
                ? "bloquear"
                : "ativar";


        const confirmed =
            confirm(
                `Deseja ${action} a empresa "${company?.nome || ""}"?`
            );


        if (!confirmed) return;


        try {

            const response =
                await apiFetch(
                    `/api/admin/companies/${id}/status`,
                    {
                        method: "PATCH",

                        body: JSON.stringify({
                            status: newStatus
                        })
                    }
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao alterar status"
                );

            }


            await this.load();

            carregarDashboard();


        } catch (error) {

            console.error(error);

            alert(
                error.message ||
                "Não foi possível alterar o status."
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