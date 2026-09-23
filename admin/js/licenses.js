const licensesPage = {

    licenses: [],

    async render() {

        const content =
            document.getElementById("content");

        content.innerHTML = `

            <div class="page-toolbar">

                <div>
                    <h2>Licenças</h2>

                    <p>
                        Gerencie as licenças das empresas.
                    </p>
                </div>

                <div class="toolbar-actions">

                    <button
                        class="secondary-button"
                        id="refreshLicensesButton"
                    >
                        ↻ Atualizar
                    </button>

                    <button
                        class="primary-button"
                        id="newLicenseButton"
                    >
                        + Nova licença
                    </button>

                </div>

            </div>


            <div class="panel">

                <div class="table-wrapper">

                    <table class="data-table">

                        <thead>

                            <tr>

                                <th>Chave</th>
                                <th>Empresa</th>
                                <th>Status</th>
                                <th>Início</th>
                                <th>Vencimento</th>
                                <th>Dispositivos</th>
                                <th>Ações</th>

                            </tr>

                        </thead>

                        <tbody id="licensesTableBody">

                            <tr>

                                <td
                                    colspan="7"
                                    class="loading"
                                >
                                    Carregando licenças...
                                </td>

                            </tr>

                        </tbody>

                    </table>

                </div>

            </div>
        `;


        document
            .getElementById("refreshLicensesButton")
            .addEventListener(
                "click",
                () => this.load()
            );


        document
            .getElementById("newLicenseButton")
            .addEventListener(
                "click",
                () => this.showCreateModal()
            );


        await this.load();
    },


    async load() {

        const tbody =
            document.getElementById(
                "licensesTableBody"
            );

        if (!tbody) return;


        tbody.innerHTML = `
            <tr>
                <td
                    colspan="7"
                    class="loading"
                >
                    Carregando licenças...
                </td>
            </tr>
        `;


        try {

            const response =
                await apiFetch(
                    "/api/admin/licenses"
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao carregar licenças"
                );
            }


            this.licenses =
                data.licenses || [];


            this.renderTable();


        } catch (error) {

            console.error(error);


            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        class="error-cell"
                    >
                        Não foi possível carregar
                        as licenças.
                    </td>
                </tr>
            `;
        }
    },


    renderTable() {

        const tbody =
            document.getElementById(
                "licensesTableBody"
            );


        if (!this.licenses.length) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        class="empty-cell"
                    >
                        Nenhuma licença cadastrada.
                    </td>
                </tr>
            `;

            return;
        }


        tbody.innerHTML =
            this.licenses.map(license => {

                const company =
                    license.companies?.nome ||
                    "—";


                const status =
                    this.formatStatus(
                        license.status
                    );


                const inicio =
                    this.formatDate(
                        license.inicio
                    );


                const vencimento =
                    this.formatDate(
                        license.vencimento
                    );


                return `

                    <tr>

                        <td>

                            <strong>
                                ${this.escape(
                                    license.chave
                                )}
                            </strong>

                        </td>


                        <td>
                            ${this.escape(company)}
                        </td>


                        <td>
                            ${status}
                        </td>


                        <td>
                            ${inicio}
                        </td>


                        <td>
                            ${vencimento}
                        </td>


                        <td>
    <strong>
        ${license.devices_used || 0}
    </strong>
</td>


                        <td>

                            <div class="table-actions">

                                <button
                                    class="secondary-button small"
                                    onclick="licensesPage.editLicense('${license.id}')"
                                >
                                    Editar
                                </button>


                                ${
                                    license.status === "active"

                                    ? `
                                        <button
                                            class="danger-button small"
                                            onclick="licensesPage.changeStatus('${license.id}', 'blocked')"
                                        >
                                            Bloquear
                                        </button>
                                    `

                                    : `
                                        <button
                                            class="success-button small"
                                            onclick="licensesPage.changeStatus('${license.id}', 'active')"
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
                    Ativa
                </span>
            `,

            blocked: `
                <span class="status-badge blocked">
                    Bloqueada
                </span>
            `,

            expired: `
                <span class="status-badge inactive">
                    Expirada
                </span>
            `
        };


        return statuses[status] || `
            <span class="status-badge">
                ${this.escape(status || "—")}
            </span>
        `;
    },


    formatDate(date) {

        if (!date) return "—";


        return new Date(date)
            .toLocaleDateString(
                "pt-BR"
            );
    },


    async changeStatus(id, status) {

        const license =
            this.licenses.find(
                item => item.id === id
            );


        if (!license) return;


        const action =
            status === "active"
                ? "ativar"
                : "bloquear";


        const confirmed =
            confirm(
                `Deseja ${action} esta licença?`
            );


        if (!confirmed) return;


        try {

            const response =
                await apiFetch(
                    `/api/admin/licenses/${id}/status`,
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
                "Não foi possível alterar o status da licença."
            );
        }
    },


   async editLicense(id) {

    const license =
        this.licenses.find(
            item => item.id === id
        );

    if (!license) return;


    const modal =
        document.createElement("div");

    modal.className =
        "modal-overlay";


    modal.innerHTML = `

        <div class="modal">

            <div class="modal-header">

                <div>

                    <h2>
                        Editar licença
                    </h2>

                    <p>
                        Altere os dados da licença.
                    </p>

                </div>


                <button
                    class="modal-close"
                    id="closeEditLicenseModal"
                >
                    ×
                </button>

            </div>


            <form id="editLicenseForm">

                <div class="form-group">

                    <label>
                        Empresa
                    </label>

                    <input
                        type="text"
                        value="${this.escape(
                            license.companies?.nome ||
                            "Sem empresa"
                        )}"
                        disabled
                    >

                </div>


                <div class="form-group">

                    <label>
                        Chave da licença
                    </label>

                    <input
                        type="text"
                        id="editLicenseKey"
                        value="${this.escape(
                            license.chave
                        )}"
                        required
                    >

                </div>


                <div class="form-row">

                    <div class="form-group">

                        <label>
                            Início
                        </label>

                        <input
                            type="datetime-local"
                            id="editLicenseStart"
                            value="${this.toDateTimeLocal(
                                new Date(
                                    license.inicio
                                )
                            )}"
                            required
                        >

                    </div>


                    <div class="form-group">

                        <label>
                            Vencimento
                        </label>

                        <input
                            type="datetime-local"
                            id="editLicenseEnd"
                            value="${this.toDateTimeLocal(
                                new Date(
                                    license.vencimento
                                )
                            )}"
                            required
                        >

                    </div>

                </div>


                <div class="form-group">

                </div>


                <div class="modal-footer">

                    <button
                        type="button"
                        class="secondary-button"
                        id="cancelEditLicenseModal"
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
        .getElementById(
            "closeEditLicenseModal"
        )
        .addEventListener(
            "click",
            () => modal.remove()
        );


    document
        .getElementById(
            "cancelEditLicenseModal"
        )
        .addEventListener(
            "click",
            () => modal.remove()
        );


    document
        .getElementById(
            "editLicenseForm"
        )
        .addEventListener(
            "submit",
            async (event) => {

                event.preventDefault();

                await this.updateLicense(
                    id,
                    modal
                );
            }
        );
},

async updateLicense(id, modal) {

    const chave =
        document
            .getElementById(
                "editLicenseKey"
            )
            .value
            .trim();


    const inicio =
        document
            .getElementById(
                "editLicenseStart"
            )
            .value;


    const vencimento =
        document
            .getElementById(
                "editLicenseEnd"
            )
            .value;



    if (
        !chave ||
        !inicio ||
        !vencimento
    ) {

        alert(
            "Preencha todos os campos."
        );

        return;
    }


    if (
        new Date(vencimento) <=
        new Date(inicio)
    ) {

        alert(
            "O vencimento precisa ser posterior ao início."
        );

        return;
    }


    try {

        const response =
            await apiFetch(
                `/api/admin/licenses/${id}`,
                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        chave,

                        inicio:
                            new Date(
                                inicio
                            ).toISOString(),

                        vencimento:
                            new Date(
                                vencimento
                            ).toISOString(),

            

                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok || !data.ok) {

            throw new Error(
                data.reason ||
                "Erro ao atualizar licença"
            );
        }


        modal.remove();


        await this.load();


        alert(
            "Licença atualizada com sucesso!"
        );


    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Não foi possível atualizar a licença."
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

        if (!companies.length) {

            alert(
                "Não existem empresas cadastradas."
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
                            Nova licença
                        </h2>

                        <p>
                            Cadastre uma nova licença
                            para uma empresa.
                        </p>

                    </div>

                    <button
                        class="modal-close"
                        id="closeLicenseModal"
                    >
                        ×
                    </button>

                </div>


                <form id="createLicenseForm">

                    <div class="form-group">

                        <label>
                            Empresa
                        </label>

                        <select
                            id="licenseCompany"
                            required
                        >

                            <option value="">
                                Selecione uma empresa
                            </option>

                            ${companies
                                .filter(
                                    company =>
                                        company.status === "active"
                                )
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
                            Chave da licença
                        </label>

                        <input
                            type="text"
                            id="licenseKey"
                            placeholder="Ex: EMPRESA-2026-001"
                            required
                        >

                    </div>


                    <div class="form-row">

                        <div class="form-group">

                            <label>
                                Início
                            </label>

                            <input
                                type="datetime-local"
                                id="licenseStart"
                                required
                            >

                        </div>


                        <div class="form-group">

                            <label>
                                Vencimento
                            </label>

                            <input
                                type="datetime-local"
                                id="licenseEnd"
                                required
                            >

                        </div>

                    </div>


                    <div class="form-group">

                    </div>


                    <div class="modal-footer">

                        <button
                            type="button"
                            class="secondary-button"
                            id="cancelLicenseModal"
                        >
                            Cancelar
                        </button>

                        <button
                            type="submit"
                            class="primary-button"
                        >
                            Criar licença
                        </button>

                    </div>

                </form>

            </div>
        `;

        document.body.appendChild(modal);


        document
            .getElementById("closeLicenseModal")
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById("cancelLicenseModal")
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById("createLicenseForm")
            .addEventListener(
                "submit",
                async (event) => {

                    event.preventDefault();

                    await this.createLicense(
                        modal
                    );
                }
            );


        const now =
            new Date();

        const start =
            new Date(
                now.getTime()
            );

        const end =
            new Date(
                now.getTime() +
                (30 * 24 * 60 * 60 * 1000)
            );


        document
            .getElementById("licenseStart")
            .value =
            this.toDateTimeLocal(start);


        document
            .getElementById("licenseEnd")
            .value =
            this.toDateTimeLocal(end);


    } catch (error) {

        console.error(error);

        alert(
            "Não foi possível carregar as empresas."
        );
    }
},


async createLicense(modal) {

    const company_id =
        document
            .getElementById("licenseCompany")
            .value;

    const chave =
        document
            .getElementById("licenseKey")
            .value
            .trim();

    const inicio =
        document
            .getElementById("licenseStart")
            .value;

    const vencimento =
        document
            .getElementById("licenseEnd")
            .value;

    if (
        !company_id ||
        !chave ||
        !inicio ||
        !vencimento
    ) {

        alert(
            "Preencha todos os campos."
        );

        return;
    }


    if (
        new Date(vencimento) <=
        new Date(inicio)
    ) {

        alert(
            "O vencimento precisa ser posterior ao início."
        );

        return;
    }


    try {

        const response =
            await apiFetch(
                "/api/admin/licenses",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        company_id,

                        chave,

                        inicio:
                            new Date(
                                inicio
                            ).toISOString(),

                        vencimento:
                            new Date(
                                vencimento
                            ).toISOString(),

                    })
                }
            );


        if (!response) return;


        const data =
            await response.json();


        if (!response.ok || !data.ok) {

            throw new Error(
                data.reason ||
                "Erro ao criar licença"
            );
        }


        modal.remove();


        await this.load();


        alert(
            "Licença criada com sucesso!"
        );


    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Não foi possível criar a licença."
        );
    }
},


toDateTimeLocal(date) {

    const pad =
        value =>
            String(value)
                .padStart(2, "0");


    return `${date.getFullYear()}-${pad(
        date.getMonth() + 1
    )}-${pad(
        date.getDate()
    )}T${pad(
        date.getHours()
    )}:${pad(
        date.getMinutes()
    )}`;
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