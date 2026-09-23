const logsPage = {

    logs: [],

    async render() {

        const content =
            document.getElementById("content");

        content.innerHTML = `

            <div class="page-toolbar">

                <div>
                    <h2>Logs</h2>

                    <p>
                        Histórico das atividades realizadas
                        no sistema.
                    </p>
                </div>

                <button
                    class="secondary-button"
                    id="refreshLogsButton"
                >
                    ↻ Atualizar
                </button>

            </div>


            <div class="panel">

                <div class="table-wrapper">

                    <table class="data-table logs-table">

                        <thead>

                            <tr>
                                <th>Data / Hora</th>
                                <th>Ação</th>
                                <th>Empresa</th>
                                <th>Usuário</th>
                                <th>Dispositivo</th>
                                <th>Administrador</th>
                                <th>Detalhes</th>
                            </tr>

                        </thead>

                        <tbody id="logsTableBody">

                            <tr>
                                <td
                                    colspan="7"
                                    class="loading"
                                >
                                    Carregando logs...
                                </td>
                            </tr>

                        </tbody>

                    </table>

                </div>

            </div>
        `;


        document
            .getElementById("refreshLogsButton")
            .addEventListener(
                "click",
                () => this.load()
            );


        await this.load();
    },


    async load() {

        const tbody =
            document.getElementById(
                "logsTableBody"
            );


        if (!tbody) return;


        try {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        class="loading"
                    >
                        Carregando logs...
                    </td>
                </tr>
            `;


            const response =
                await apiFetch(
                    "/api/admin/logs"
                );


            if (!response) return;


            const data =
                await response.json();


            if (!response.ok || !data.ok) {

                throw new Error(
                    data.reason ||
                    "Erro ao carregar logs"
                );
            }


            this.logs =
                data.logs || [];


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
                        os logs.
                    </td>
                </tr>
            `;
        }
    },


    renderTable() {

        const tbody =
            document.getElementById(
                "logsTableBody"
            );


        if (!this.logs.length) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        class="empty-cell"
                    >
                        Nenhum log registrado.
                    </td>
                </tr>
            `;

            return;
        }


        tbody.innerHTML =
            this.logs.map(log => {

                const date =
                    log.created_at
                        ? new Date(
                            log.created_at
                        ).toLocaleString(
                            "pt-BR"
                        )
                        : "—";


                const company =
                    log.companies?.nome ||
                    "—";


                const user =
                    log.users?.nome ||
                    "—";


                const admin =
                    log.admins?.nome ||
                    log.admins?.email ||
                    "—";


                const device =
    log.devices?.nome ||
    log.devices?.device_id ||
    log.detalhes?.device_id ||
    log.device_id ||
    "—";


                const action =
                    this.formatAction(
                        log.acao
                    );


                const details =
                    log.detalhes
                        ? JSON.stringify(
                            log.detalhes,
                            null,
                            0
                        )
                        : "—";


                return `

                    <tr>

                        <td class="log-date">
                            ${date}
                        </td>


                        <td>

                            <span class="log-action">
                                ${this.escape(action)}
                            </span>

                        </td>


                        <td>
                            ${this.escape(company)}
                        </td>


                        <td>
                            ${this.escape(user)}
                        </td>


                        <td>
                            <span class="device-id">
                                ${this.escape(device)}
                            </span>
                        </td>


                        <td>
                            ${this.escape(admin)}
                        </td>


                        <td>

                            <button
                                class="details-button"
                                onclick='logsPage.showDetails(${JSON.stringify(
                                    log.detalhes || {}
                                )})'
                            >
                                Ver detalhes
                            </button>

                        </td>

                    </tr>

                `;

            }).join("");
    },


    formatAction(action) {

        const actions = {

            admin_login:
                "Login administrativo",

            company_created:
                "Empresa criada",

            company_updated:
                "Empresa atualizada",

            company_status_changed:
                "Status da empresa alterado",

            license_created:
                "Licença criada",

            license_updated:
                "Licença atualizada",

            license_status_changed:
                "Status da licença alterado",

            user_created:
                "Usuário criado",

            user_updated:
                "Usuário atualizado",

            user_status_changed:
                "Status do usuário alterado",

            device_activated:
                "Dispositivo ativado",
            
            device_name_changed:
               "Nome do dispositivo alterado",

            device_status_changed:
                "Status do dispositivo alterado"
        };


        return actions[action] || action || "—";
    },


    showDetails(details) {

        const modal =
            document.createElement("div");

        modal.className =
            "modal-overlay";


        modal.innerHTML = `

            <div class="modal details-modal">

                <div class="modal-header">

                    <div>

                        <h2>
                            Detalhes do log
                        </h2>

                        <p>
                            Informações registradas
                            pela atividade.
                        </p>

                    </div>


                    <button
                        class="modal-close"
                        id="closeLogDetails"
                    >
                        ×
                    </button>

                </div>


                <div class="details-content">

                    <pre>${this.escape(
                        JSON.stringify(
                            details,
                            null,
                            2
                        )
                    )}</pre>

                </div>


                <div class="modal-footer">

                    <button
                        class="secondary-button"
                        id="closeLogDetailsButton"
                    >
                        Fechar
                    </button>

                </div>

            </div>
        `;


        document.body.appendChild(modal);


        document
            .getElementById(
                "closeLogDetails"
            )
            .addEventListener(
                "click",
                () => modal.remove()
            );


        document
            .getElementById(
                "closeLogDetailsButton"
            )
            .addEventListener(
                "click",
                () => modal.remove()
            );
    },


    escape(value) {

        return String(value ?? "")
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

};

