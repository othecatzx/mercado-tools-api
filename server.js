const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();
const app = express();

const path = require("path");

console.log("ASAAS URL:", process.env.ASAAS_API_URL);
console.log(
    "ASAAS KEY PREFIX:",
    process.env.ASAAS_API_KEY
        ? process.env.ASAAS_API_KEY.substring(0, 10)
        : "NÃO DEFINIDA"
);
app.use(express.json({
    type: ["application/json", "application/*+json", "text/plain"]
}));
app.use(cors());

app.use("/admin", express.static(path.join(__dirname, "admin")));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

function verificarAdmin(req, res, next) {
    try {
        const authorization = req.headers.authorization;

        if (!authorization) {
            return res.status(401).json({
                authorized: false,
                reason: "missing_token"
            });
        }

        const token = authorization.split(" ")[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.admin = decoded;

        next();

    } catch (error) {
        return res.status(401).json({
            authorized: false,
            reason: "invalid_token"
        });
    }
}

app.use("/admin", express.static("admin"));

app.get("/api/admin/test", verificarAdmin, (req, res) => {
    res.json({
        authorized: true,
        message: "Admin autenticado!",
        admin: req.admin
    });
});

app.get("/api/admin/companies", verificarAdmin, async (req, res) => {
    try {
        const { data: companies, error } = await supabase
            .from("companies")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Erro ao buscar empresas:", error);

            return res.status(500).json({
                ok: false,
                reason: "database_error",
                message: "Erro ao buscar empresas"
            });
        }

        return res.json({
            ok: true,
            companies
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.post("/api/checkout", async (req, res) => {
    try {
        const {
            plan_id,
            nome,
            email,
            cpfCnpj,
            phone,
            address,
            addressNumber,
            complement,
            postalCode,
            province,
            city
        } = req.body;

        // ==============================
        // VALIDAÇÃO
        // ==============================

        if (
            !plan_id ||
            !nome ||
            !email ||
            !cpfCnpj ||
            !phone ||
            !address ||
            !addressNumber ||
            !postalCode ||
            !province ||
            !city
        ) {
            return res.status(400).json({
                ok: false,
                error: "Todos os dados do cliente são obrigatórios"
            });
        }

        // ==============================
        // NORMALIZAR DADOS
        // ==============================

        const cpfLimpo = String(cpfCnpj).replace(/\D/g, "");
        const telefoneLimpo = String(phone).replace(/\D/g, "");
        const cepLimpo = String(postalCode).replace(/\D/g, "");

        // CPF ou CNPJ
        if (
            cpfLimpo.length !== 11 &&
            cpfLimpo.length !== 14
        ) {
            return res.status(400).json({
                ok: false,
                error: "CPF/CNPJ inválido"
            });
        }

        // Telefone
        if (
            telefoneLimpo.length < 10 ||
            telefoneLimpo.length > 11
        ) {
            return res.status(400).json({
                ok: false,
                error: "Telefone inválido"
            });
        }

        // CEP
        if (cepLimpo.length !== 8) {
            return res.status(400).json({
                ok: false,
                error: "CEP deve possuir 8 números"
            });
        }

        // ==============================
        // BUSCAR PLANO
        // ==============================

        const { data: plano, error: planoError } =
            await supabase
                .from("plans")
                .select("*")
                .eq("id", plan_id)
                .eq("status", "active")
                .single();

        if (planoError || !plano) {
            return res.status(404).json({
                ok: false,
                error: "Plano não encontrado"
            });
        }

        // ==============================
        // PRÓXIMA COBRANÇA
        // ==============================

        const nextDueDate = new Date();

        nextDueDate.setDate(
            nextDueDate.getDate() + 1
        );

        const nextDueDateFormatted =
            nextDueDate.toISOString().split("T")[0];

        // ==============================
        // CRIAR CHECKOUT ASAAS
        // ==============================

        const response = await axios.post(
            `${process.env.ASAAS_API_URL}/checkouts`,
            {
                billingTypes: [
                    "CREDIT_CARD"
                ],

                chargeTypes: [
                    "RECURRENT"
                ],

                minutesToExpire: 60,

                externalReference:
                    `plan_${plano.id}`,

                callback: {
                    successUrl:
                        "https://google.com",

                    cancelUrl:
                        "https://google.com",

                    expiredUrl:
                        "https://google.com"
                },

                items: [
                    {
                        name: plano.nome,

                        description:
                            plano.descricao ||
                            "Assinatura Mercado Tools",

                        quantity: 1,

                        value:
                            Number(plano.preco)
                    }
                ],

                customerData: {
                    name:
                        nome.trim(),

                    cpfCnpj:
                        cpfLimpo,

                    email:
                        email.trim().toLowerCase(),

                    phone:
                        telefoneLimpo,

                    address:
                        address.trim(),

                    addressNumber:
                        String(addressNumber),

                    complement:
                        complement || "",

                    postalCode:
                        cepLimpo,

                    province:
                        province.trim(),

                    city:
                        Number(city)
                },

                subscription: {
                    cycle: "MONTHLY",

                    nextDueDate:
                        nextDueDateFormatted
                }
            },

            {
                headers: {
                    access_token:
                        process.env.ASAAS_API_KEY,

                    "Content-Type":
                        "application/json"
                }
            }
        );

        // ==============================
        // SUCESSO
        // ==============================

        console.log(
            "================================="
        );

        console.log(
            "CHECKOUT ASAAS CRIADO"
        );

        console.log(
            "ID:",
            response.data.id
        );

        console.log(
            "Plano:",
            plano.nome
        );

        console.log(
            "Vencimento:",
            nextDueDateFormatted
        );

        console.log(
            "================================="
        );

        console.log("=================================");
console.log("CHECKOUT ASAAS CRIADO");
console.log("ID:", response.data.id);
console.log("Plano:", plano.nome);
console.log("Vencimento:", nextDueDate);
console.log("Checkout completo:", JSON.stringify(response.data, null, 2));
console.log("=================================");

const checkoutId = response.data.id;
const subscriptionId = response.data.subscription?.id || null;
const { error: checkoutSaveError } = await supabase
    .from("checkout_sessions")
    .insert({
        checkout_id: checkoutId,
        plan_id: plano.id,
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        cpf_cnpj: cpfLimpo,
        telefone: telefoneLimpo,
        status: "pending"
    });

if (checkoutSaveError) {
    console.error(
        "Erro ao salvar checkout no Supabase:",
        checkoutSaveError
    );
}

return res.json({
    ok: true,
    checkout: response.data
});

    } catch (error) {

        console.error(
            "Erro Asaas:",
            error.response?.data ||
            error.message
        );

        return res.status(500).json({
            ok: false,

            error:
                "Erro ao criar checkout",

            details:
                error.response?.data ||
                null
        });
    }
});

// ==========================================
// CRIAR EMPRESA
// ==========================================

app.post("/api/admin/companies", verificarAdmin, async (req, res) => {
    try {
        const { nome, documento } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({
                ok: false,
                reason: "missing_name",
                message: "Nome da empresa é obrigatório"
            });
        }

        // Criar empresa
        const { data: company, error: companyError } = await supabase
            .from("companies")
            .insert({
                nome: nome.trim(),
                documento: documento ? documento.trim() : null,
                status: "active"
            })
            .select("*")
            .single();

        if (companyError) {
            console.error("Erro ao criar empresa:", companyError);

            return res.status(500).json({
                ok: false,
                reason: "database_error",
                message: "Não foi possível criar a empresa"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: company.id,
                admin_id: req.admin.admin_id,
                acao: "company_created",
                detalhes: {
                    nome: company.nome,
                    documento: company.documento
                }
            });

        return res.status(201).json({
            ok: true,
            company
        });

    } catch (error) {
        console.error("Erro inesperado ao criar empresa:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

// ==========================================
// EDITAR EMPRESA
// ==========================================

app.put("/api/admin/companies/:id", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, documento } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({
                ok: false,
                reason: "missing_name",
                message: "Nome da empresa é obrigatório"
            });
        }

        // Verificar se a empresa existe
        const { data: existingCompany, error: findError } = await supabase
            .from("companies")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            console.error("Erro ao buscar empresa:", findError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingCompany) {
            return res.status(404).json({
                ok: false,
                reason: "company_not_found",
                message: "Empresa não encontrada"
            });
        }

        // Atualizar empresa
        const { data: company, error: updateError } = await supabase
            .from("companies")
            .update({
                nome: nome.trim(),
                documento: documento ? documento.trim() : null,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select("*")
            .single();

        if (updateError) {
            console.error("Erro ao atualizar empresa:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error",
                message: "Não foi possível atualizar a empresa"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: company.id,
                admin_id: req.admin.admin_id,
                acao: "company_updated",
                detalhes: {
                    antes: {
                        nome: existingCompany.nome,
                        documento: existingCompany.documento
                    },
                    depois: {
                        nome: company.nome,
                        documento: company.documento
                    }
                }
            });

        return res.json({
            ok: true,
            company
        });

    } catch (error) {
        console.error("Erro inesperado ao editar empresa:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

// ==========================================
// ALTERAR STATUS DA EMPRESA
// ==========================================

app.patch("/api/admin/companies/:id/status", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!["active", "blocked", "inactive"].includes(status)) {
            return res.status(400).json({
                ok: false,
                reason: "invalid_status",
                message: "Status inválido"
            });
        }

        // Buscar empresa atual
        const { data: existingCompany, error: findError } = await supabase
            .from("companies")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            console.error("Erro ao buscar empresa:", findError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingCompany) {
            return res.status(404).json({
                ok: false,
                reason: "company_not_found",
                message: "Empresa não encontrada"
            });
        }

        // Atualizar status
        const { data: company, error: updateError } = await supabase
            .from("companies")
            .update({
                status,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select("*")
            .single();

        if (updateError) {
            console.error("Erro ao alterar status:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: company.id,
                admin_id: req.admin.admin_id,
                acao: "company_status_changed",
                detalhes: {
                    status_anterior: existingCompany.status,
                    status_novo: company.status
                }
            });

        return res.json({
            ok: true,
            company
        });

    } catch (error) {
        console.error("Erro inesperado ao alterar status:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});


// ==========================================
// LISTAR LICENÇAS
// ==========================================

app.get("/api/admin/licenses", verificarAdmin, async (req, res) => {
    try {

        const { data: licenses, error } =
            await supabase
                .from("licenses")
                .select(`
                    *,
                    companies (
                        id,
                        nome,
                        documento,
                        status,
                        devices (
                            id,
                            device_id,
                            nome,
                            status
                        )
                    )
                `)
                .order("created_at", {
                    ascending: false
                });


        if (error) {

            console.error(
                "Erro ao buscar licenças:",
                error
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }


        const licensesWithUsage =
            (licenses || []).map(license => {

                const devices =
                    license.companies?.devices || [];


                const devicesUsed =
                    devices.filter(
                        device =>
                            device.status === "active" ||
                            device.status === "blocked"
                    ).length;


                return {
                    ...license,

                    devices_used:
                        devicesUsed
                };
            });


        return res.json({
            ok: true,
            licenses: licensesWithUsage
        });


    } catch (error) {

        console.error(
            "Erro inesperado:",
            error
        );

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

// ==========================================
// CRIAR LICENÇA
// ==========================================

app.post("/api/admin/licenses", verificarAdmin, async (req, res) => {
    try {
        const {
            company_id,
            chave,
            inicio,
            vencimento
        } = req.body;

        if (
    !company_id ||
    !chave ||
    !inicio ||
    !vencimento
) {
    console.log("ERRO - DADOS RECEBIDOS:", req.body);

    return res.status(400).json({
        ok: false,
        reason: "missing_fields",
        received: req.body
    });
}

        // Verificar empresa
        const { data: company, error: companyError } = await supabase
            .from("companies")
            .select("*")
            .eq("id", company_id)
            .maybeSingle();

        if (companyError) {
            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!company) {
            return res.status(404).json({
                ok: false,
                reason: "company_not_found"
            });
        }

        // Verificar se a chave já existe
        const { data: existingLicense } = await supabase
            .from("licenses")
            .select("id")
            .eq("chave", chave.trim())
            .maybeSingle();

        if (existingLicense) {
            return res.status(409).json({
                ok: false,
                reason: "license_key_already_exists"
            });
        }

        // Criar licença
        const { data: license, error: licenseError } = await supabase
            .from("licenses")
            .insert({
                company_id,
                chave: chave.trim(),
                status: "active",
                inicio,
                vencimento
            })
            .select()
            .single();

        if (licenseError) {
            console.error("Erro ao criar licença:", licenseError);

            return res.status(500).json({
                ok: false,
                reason: "database_error",
                message: licenseError.message
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id,
                admin_id: req.admin.admin_id,
                acao: "license_created",
                detalhes: {
                    license_id: license.id,
                    chave: license.chave,
                    vencimento: license.vencimento
                }
            });

        return res.status(201).json({
            ok: true,
            license
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});


app.put("/api/admin/licenses/:id", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            chave,
            inicio,
            vencimento
        } = req.body;

        if (
            !chave ||
            !inicio ||
            !vencimento
        ) {
            return res.status(400).json({
                ok: false,
                reason: "missing_fields"
            });
        }

        // Buscar licença atual
        const { data: existingLicense, error: findError } = await supabase
            .from("licenses")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingLicense) {
            return res.status(404).json({
                ok: false,
                reason: "license_not_found"
            });
        }

        // Verificar se a nova chave já pertence a outra licença
        const { data: duplicateLicense } = await supabase
            .from("licenses")
            .select("id")
            .eq("chave", chave.trim())
            .neq("id", id)
            .maybeSingle();

        if (duplicateLicense) {
            return res.status(409).json({
                ok: false,
                reason: "license_key_already_exists"
            });
        }

        // Atualizar
        const { data: license, error: updateError } = await supabase
            .from("licenses")
            .update({
                chave: chave.trim(),
                inicio,
                vencimento,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Erro ao atualizar licença:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        // Log
        await supabase
            .from("logs")
            .insert({
                company_id: existingLicense.company_id,
                admin_id: req.admin.admin_id,
                acao: "license_updated",
                detalhes: {
                    license_id: id,
                    before: existingLicense,
                    after: license
                }
            });

        return res.json({
            ok: true,
            license
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});


app.patch("/api/admin/licenses/:id/status", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const statusesPermitidos = ["active", "blocked", "expired"];

        if (!statusesPermitidos.includes(status)) {
            return res.status(400).json({
                ok: false,
                reason: "invalid_status",
                allowed: statusesPermitidos
            });
        }

        // Buscar licença atual
        const { data: existingLicense, error: findError } = await supabase
            .from("licenses")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingLicense) {
            return res.status(404).json({
                ok: false,
                reason: "license_not_found"
            });
        }

        // Atualizar status
        const { data: license, error: updateError } = await supabase
            .from("licenses")
            .update({
                status,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Erro ao alterar status:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: existingLicense.company_id,
                admin_id: req.admin.admin_id,
                acao: "license_status_changed",
                detalhes: {
                    license_id: id,
                    old_status: existingLicense.status,
                    new_status: status
                }
            });

        return res.json({
            ok: true,
            license
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

// ==========================================
// LISTAR USUÁRIOS
// ==========================================

app.get("/api/admin/users", verificarAdmin, async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from("users")
            .select(`
                *,
                companies (
                    id,
                    nome,
                    documento,
                    status
                )
            `)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Erro ao buscar usuários:", error);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        return res.json({
            ok: true,
            users
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.post("/api/admin/users", verificarAdmin, async (req, res) => {
    try {
        const { company_id, nome, email } = req.body;

        if (!company_id || !nome || !email) {
            return res.status(400).json({
                ok: false,
                reason: "missing_fields"
            });
        }

        // Verificar empresa
        const { data: company, error: companyError } = await supabase
            .from("companies")
            .select("*")
            .eq("id", company_id)
            .maybeSingle();

        if (companyError) {
            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!company) {
            return res.status(404).json({
                ok: false,
                reason: "company_not_found"
            });
        }

        // Verificar usuário duplicado na mesma empresa
        const { data: existingUser } = await supabase
            .from("users")
            .select("id")
            .eq("company_id", company_id)
            .eq("email", email.trim().toLowerCase())
            .maybeSingle();

        if (existingUser) {
            return res.status(409).json({
                ok: false,
                reason: "user_already_exists"
            });
        }

        // Criar usuário
        const { data: user, error: userError } = await supabase
            .from("users")
            .insert({
                company_id,
                nome: nome.trim(),
                email: email.trim().toLowerCase(),
                status: "active"
            })
            .select()
            .single();

        if (userError) {
            console.error("Erro ao criar usuário:", userError);

            return res.status(500).json({
                ok: false,
                reason: "database_error",
                message: userError.message
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id,
                admin_id: req.admin.admin_id,
                acao: "user_created",
                detalhes: {
                    user_id: user.id,
                    nome: user.nome,
                    email: user.email
                }
            });

        return res.status(201).json({
            ok: true,
            user
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.put("/api/admin/users/:id", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, email } = req.body;

        if (!nome || !email) {
            return res.status(400).json({
                ok: false,
                reason: "missing_fields"
            });
        }

        // Buscar usuário atual
        const { data: existingUser, error: findError } = await supabase
            .from("users")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingUser) {
            return res.status(404).json({
                ok: false,
                reason: "user_not_found"
            });
        }

        const emailNormalizado = email.trim().toLowerCase();

        // Verificar e-mail duplicado na mesma empresa
        const { data: duplicateUser } = await supabase
            .from("users")
            .select("id")
            .eq("company_id", existingUser.company_id)
            .eq("email", emailNormalizado)
            .neq("id", id)
            .maybeSingle();

        if (duplicateUser) {
            return res.status(409).json({
                ok: false,
                reason: "user_email_already_exists"
            });
        }

        // Atualizar
        const { data: user, error: updateError } = await supabase
            .from("users")
            .update({
                nome: nome.trim(),
                email: emailNormalizado
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Erro ao atualizar usuário:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: existingUser.company_id,
                user_id: id,
                admin_id: req.admin.admin_id,
                acao: "user_updated",
                detalhes: {
                    before: {
                        nome: existingUser.nome,
                        email: existingUser.email
                    },
                    after: {
                        nome: user.nome,
                        email: user.email
                    }
                }
            });

        return res.json({
            ok: true,
            user
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.patch("/api/admin/users/:id/status", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const statusesPermitidos = [
            "active",
            "blocked",
            "inactive"
        ];

        if (!statusesPermitidos.includes(status)) {
            return res.status(400).json({
                ok: false,
                reason: "invalid_status",
                allowed: statusesPermitidos
            });
        }

        // Buscar usuário atual
        const { data: existingUser, error: findError } = await supabase
            .from("users")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingUser) {
            return res.status(404).json({
                ok: false,
                reason: "user_not_found"
            });
        }

        // Atualizar status
        const { data: user, error: updateError } = await supabase
            .from("users")
            .update({
                status
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Erro ao alterar status:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: existingUser.company_id,
                user_id: id,
                admin_id: req.admin.admin_id,
                acao: "user_status_changed",
                detalhes: {
                    old_status: existingUser.status,
                    new_status: status
                }
            });

        return res.json({
            ok: true,
            user
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        message: "Mercado Tools API funcionando"
    });
});

app.get("/api/test-supabase", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("companies")
            .select("*")
            .limit(10);

        if (error) {
            return res.status(500).json({
                ok: false,
                error: error.message
            });
        }

        res.json({
            ok: true,
            companies: data
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.post("/api/license/activate", async (req, res) => {
  try {
    const { chave, device_id, device_name } = req.body;

    if (!chave || !device_id) {
      return res.status(400).json({
        authorized: false,
        reason: "missing_data",
        message: "Chave e device_id são obrigatórios"
      });
    }

    // 1. Buscar licença
    const { data: license, error: licenseError } = await supabase
      .from("licenses")
      .select("*")
      .eq("chave", chave)
      .maybeSingle();

    if (licenseError) {
      console.error("Erro ao buscar licença:", licenseError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error"
      });
    }

    if (!license) {
      return res.status(404).json({
        authorized: false,
        reason: "invalid_license",
        message: "Licença não encontrada"
      });
    }

    // 2. Verificar status da licença
    if (license.status !== "active") {
      return res.status(403).json({
        authorized: false,
        reason: "license_inactive",
        message: "Licença não está ativa"
      });
    }

    // 3. Verificar vencimento
    if (
      license.vencimento &&
      new Date(license.vencimento).getTime() < Date.now()
    ) {
      return res.status(403).json({
        authorized: false,
        reason: "license_expired",
        message: "Licença expirada"
      });
    }

    // 4. Buscar empresa
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", license.company_id)
      .maybeSingle();

    if (companyError) {
      console.error("Erro ao buscar empresa:", companyError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error"
      });
    }

    if (!company) {
      return res.status(404).json({
        authorized: false,
        reason: "company_not_found"
      });
    }

    // 5. Verificar empresa
    if (company.status !== "active") {
      return res.status(403).json({
        authorized: false,
        reason: "company_inactive",
        message: "Empresa não está ativa"
      });
    }

    // 6. Verificar se o dispositivo já existe
    const { data: existingDevice, error: deviceError } = await supabase
      .from("devices")
      .select("*")
      .eq("company_id", company.id)
      .eq("device_id", device_id)
      .maybeSingle();

    if (deviceError) {
      console.error("Erro ao buscar dispositivo:", deviceError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error"
      });
    }

    // 7. Dispositivo já ativo
if (existingDevice?.status === "active") {
  return res.status(409).json({
    authorized: false,
    reason: "already_active",
    message: "Esta licença já está ativa neste dispositivo.",
    company: company.nome,
    device_id: device_id,
    license_expires_at: license.vencimento
  });
}

    // 8. Dispositivo bloqueado
    if (existingDevice?.status === "blocked") {
      return res.status(403).json({
        authorized: false,
        reason: "device_blocked",
        message: "Este dispositivo está bloqueado"
      });
    }

    // 9. Registrar dispositivo
    const { data: newDevice, error: insertError } = await supabase
      .from("devices")
      .insert({
        company_id: company.id,
        device_id: device_id,
        nome: device_name || "Dispositivo",
        status: "active",
        ultimo_acesso: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erro ao registrar dispositivo:", insertError);

      return res.status(500).json({
        authorized: false,
        reason: "device_registration_failed"
      });
    }

    // 12. Registrar log
    await supabase
      .from("logs")
      .insert({
        company_id: company.id,
        device_id: newDevice.id,
        acao: "device_activated",
        detalhes: {
          device_identifier: device_id,
          device_name: device_name || "Dispositivo"
        }
      });

    // 13. Sucesso
    return res.status(201).json({
      authorized: true,
      reason: "device_registered",
      company: company.nome,
      device_id: device_id,
      license_expires_at: license.vencimento
    });

  } catch (error) {
    console.error("Erro inesperado:", error);

    return res.status(500).json({
      authorized: false,
      reason: "internal_error"
    });
  }
});

const PORT = process.env.PORT || 3000;

// ==========================================
// VERIFICAR LICENÇA + DISPOSITIVO
// ==========================================

app.post("/api/license/check", async (req, res) => {
  try {
    const { chave, device_id } = req.body;

    if (!chave || !device_id) {
      return res.status(400).json({
        authorized: false,
        reason: "missing_data"
      });
    }

    // Busca a licença
    const { data: license, error: licenseError } = await supabase
      .from("licenses")
      .select("*")
      .eq("chave", chave)
      .single();

    if (licenseError || !license) {
      return res.status(404).json({
        authorized: false,
        reason: "invalid_license"
      });
    }

    // Licença bloqueada/inativa
    if (license.status !== "active") {
      return res.status(403).json({
        authorized: false,
        reason: "license_inactive"
      });
    }

    // Licença expirada
    if (
      license.vencimento &&
      new Date(license.vencimento).getTime() < Date.now()
    ) {
      return res.status(403).json({
        authorized: false,
        reason: "license_expired"
      });
    }

    // Busca empresa
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", license.company_id)
      .single();

    if (companyError || !company) {
      return res.status(404).json({
        authorized: false,
        reason: "company_not_found"
      });
    }

    // Empresa bloqueada/inativa
    if (company.status !== "active") {
      return res.status(403).json({
        authorized: false,
        reason: "company_inactive"
      });
    }

    // Busca dispositivo
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("*")
      .eq("company_id", company.id)
      .eq("device_id", device_id)
      .single();

    if (deviceError || !device) {
      return res.status(403).json({
        authorized: false,
        reason: "device_not_registered"
      });
    }

    // Dispositivo bloqueado
    if (device.status === "blocked") {
  return res.json({
    authorized: false,
    reason: "device_blocked",
    status: "blocked",
    company: company.nome,
    company_id: company.id,
    device_id,
    license_expires_at: license.vencimento
  });
}

    // Dispositivo removido
    if (device.status === "removed") {
  return res.json({
    authorized: false,
    reason: "device_removed",
    status: "removed",
    company: company.nome,
    company_id: company.id,
    device_id,
    license_expires_at: license.vencimento
  });
}

    // Atualiza último acesso
    await supabase
      .from("devices")
      .update({
        ultimo_acesso: new Date().toISOString()
      })
      .eq("id", device.id);

    return res.json({
      authorized: true,
      company: company.nome,
      device_id: device.device_id,
      license_expires_at: license.vencimento
    });

  } catch (error) {
    console.error("Erro ao verificar licença:", error);

    return res.status(500).json({
      authorized: false,
      reason: "server_error"
    });
  }
});

// ==========================================
// LOGIN DO ADMIN
// ==========================================

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({
        authorized: false,
        reason: "missing_credentials",
        message: "E-mail e senha são obrigatórios"
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admins")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (adminError) {
      console.error("Erro ao buscar administrador:", adminError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error"
      });
    }

    if (!admin) {
      return res.status(401).json({
        authorized: false,
        reason: "invalid_credentials"
      });
    }

    if (admin.status !== "active") {
      return res.status(403).json({
        authorized: false,
        reason: "admin_blocked"
      });
    }

    if (!admin.senha_hash) {
      return res.status(500).json({
        authorized: false,
        reason: "password_not_configured"
      });
    }

    const senhaCorreta = await bcrypt.compare(
      senha,
      admin.senha_hash
    );

    if (!senhaCorreta) {
      return res.status(401).json({
        authorized: false,
        reason: "invalid_credentials"
      });
    }

    // Criar token
    const token = jwt.sign(
      {
        admin_id: admin.id,
        email: admin.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h"
      }
    );

    // Registrar login
    await supabase
      .from("logs")
      .insert({
        admin_id: admin.id,
        acao: "admin_login",
        detalhes: {
          email: admin.email
        }
      });

    return res.json({
      authorized: true,
      token,
      admin: {
        id: admin.id,
        nome: admin.nome,
        email: admin.email
      }
    });

  } catch (error) {
    console.error("Erro no login:", error);

    return res.status(500).json({
      authorized: false,
      reason: "server_error"
    });
  }
});


// ==========================================
// LISTAR DISPOSITIVOS
// ==========================================

app.get("/api/admin/devices", verificarAdmin, async (req, res) => {
    try {
        const { data: devices, error } = await supabase
            .from("devices")
            .select(`
                *,
                companies (
                    id,
                    nome,
                    documento,
                    status
                ),
                users (
                    id,
                    nome,
                    email,
                    status
                )
            `)
            .order("ultimo_acesso", { ascending: false });

        if (error) {
            console.error("Erro ao buscar dispositivos:", error);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        return res.json({
            ok: true,
            devices
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.patch("/api/admin/devices/:id/status", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const statusesPermitidos = [
            "active",
            "blocked",
            "removed"
        ];

        if (!statusesPermitidos.includes(status)) {
            return res.status(400).json({
                ok: false,
                reason: "invalid_status",
                allowed: statusesPermitidos
            });
        }

        // Buscar dispositivo atual
        const { data: existingDevice, error: findError } = await supabase
            .from("devices")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            console.error("Erro ao buscar dispositivo:", findError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingDevice) {
            return res.status(404).json({
                ok: false,
                reason: "device_not_found"
            });
        }

        // Atualizar status
        const { data: device, error: updateError } = await supabase
            .from("devices")
            .update({
                status
            })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Erro ao alterar dispositivo:", updateError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id: existingDevice.company_id,
                user_id: existingDevice.user_id,
                device_id: id,
                admin_id: req.admin.admin_id,
                acao: "device_status_changed",
                detalhes: {
                    device_identifier: existingDevice.device_id,
                    old_status: existingDevice.status,
                    new_status: status
                }
            });

        return res.json({
            ok: true,
            device
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});


app.delete("/api/admin/devices/:id", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar dispositivo antes de excluir
        const { data: existingDevice, error: findError } = await supabase
            .from("devices")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (findError) {
            console.error("Erro ao buscar dispositivo:", findError);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!existingDevice) {
            return res.status(404).json({
                ok: false,
                reason: "device_not_found",
                message: "Dispositivo não encontrado"
            });
        }

        // Excluir permanentemente do banco
        const { error: deleteError } = await supabase
            .from("devices")
            .delete()
            .eq("id", id);

        if (deleteError) {
            console.error(
                "Erro ao excluir dispositivo:",
                deleteError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error",
                message: "Não foi possível excluir o dispositivo"
            });
        }

        // Registrar log da exclusão
        await supabase
            .from("logs")
            .insert({
                company_id: existingDevice.company_id,
                user_id: existingDevice.user_id,
                device_id: id,
                admin_id: req.admin.admin_id,
                acao: "device_deleted",
                detalhes: {
                    device_identifier: existingDevice.device_id,
                    device_name: existingDevice.nome,
                    previous_status: existingDevice.status
                }
            });

        return res.json({
            ok: true,
            message: "Dispositivo excluído com sucesso"
        });

    } catch (error) {
        console.error(
            "Erro inesperado ao excluir dispositivo:",
            error
        );

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.patch("/api/admin/devices/:id/user", verificarAdmin, async (req, res) => {
    try {

        const { id } = req.params;
        const { user_id } = req.body;


        // Buscar dispositivo
        const { data: existingDevice, error: deviceError } =
            await supabase
                .from("devices")
                .select("*")
                .eq("id", id)
                .maybeSingle();


        if (deviceError) {

            console.error(
                "Erro ao buscar dispositivo:",
                deviceError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }


        if (!existingDevice) {

            return res.status(404).json({
                ok: false,
                reason: "device_not_found"
            });
        }


        let newUser = null;


        // Se user_id foi informado, validar usuário
        if (user_id !== null && user_id !== undefined && user_id !== "") {

            const { data: user, error: userError } =
                await supabase
                    .from("users")
                    .select("*")
                    .eq("id", user_id)
                    .maybeSingle();


            if (userError) {

                console.error(
                    "Erro ao buscar usuário:",
                    userError
                );

                return res.status(500).json({
                    ok: false,
                    reason: "database_error"
                });
            }


            if (!user) {

                return res.status(404).json({
                    ok: false,
                    reason: "user_not_found"
                });
            }


            // Usuário precisa pertencer à mesma empresa
            if (
                user.company_id !==
                existingDevice.company_id
            ) {

                return res.status(400).json({
                    ok: false,
                    reason: "user_company_mismatch"
                });
            }


            // Usuário bloqueado/inativo não pode ser vinculado
            if (user.status !== "active") {

                return res.status(400).json({
                    ok: false,
                    reason: "user_inactive"
                });
            }


            newUser = user;
        }


        // Atualizar dispositivo
        const { data: device, error: updateError } =
            await supabase
                .from("devices")
                .update({
                    user_id:
                        newUser
                            ? newUser.id
                            : null
                })
                .eq("id", id)
                .select()
                .single();


        if (updateError) {

            console.error(
                "Erro ao vincular usuário:",
                updateError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }


        // Registrar log
        await supabase
            .from("logs")
            .insert({
                company_id:
                    existingDevice.company_id,

                user_id:
                    newUser
                        ? newUser.id
                        : existingDevice.user_id,

                device_id:
                    id,

                admin_id:
                    req.admin.admin_id,

                acao:
                    "device_user_changed",

                detalhes: {

                    device_identifier:
                        existingDevice.device_id,

                    old_user_id:
                        existingDevice.user_id,

                    new_user_id:
                        newUser
                            ? newUser.id
                            : null,

                    new_user_name:
                        newUser
                            ? newUser.nome
                            : null
                }
            });


        return res.json({
            ok: true,
            device
        });


    } catch (error) {

        console.error(
            "Erro inesperado:",
            error
        );

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

// ==========================================
// DEFINIR ADM DO MERCADO LIVRE
// ==========================================

app.patch(
    "/api/admin/devices/:id/mercadolivre-admin",
    verificarAdmin,
    async (req, res) => {

        try {

            const { id } = req.params;

            const { mercadolivre_admin } =
                req.body;

            const novoStatus =
                mercadolivre_admin === true;


            // Buscar dispositivo
            const { data: device, error: deviceError } =
                await supabase
                    .from("devices")
                    .select(`
                        id,
                        device_id,
                        nome,
                        company_id,
                        user_id,
                        mercadolivre_admin
                    `)
                    .eq("id", id)
                    .maybeSingle();


            if (deviceError) {

                console.error(
                    "Erro ao buscar dispositivo ML ADM:",
                    deviceError
                );

                return res.status(500).json({
                    ok: false,
                    reason: "database_error"
                });

            }


            if (!device) {

                return res.status(404).json({
                    ok: false,
                    reason: "device_not_found",
                    message: "Dispositivo não encontrado"
                });

            }


            // ==========================================
            // SE ESTIVER MARCANDO COMO ADM
            // REMOVE O ADM DOS OUTROS DISPOSITIVOS
            // DA MESMA EMPRESA
            // ==========================================

            if (novoStatus) {

                const { error: resetError } =
                    await supabase
                        .from("devices")
                        .update({
                            mercadolivre_admin: false
                        })
                        .eq(
                            "company_id",
                            device.company_id
                        );


                if (resetError) {

                    console.error(
                        "Erro ao remover ADM anterior:",
                        resetError
                    );

                    return res.status(500).json({
                        ok: false,
                        reason: "database_error",
                        message:
                            "Não foi possível atualizar o ADM anterior."
                    });

                }

            }


            // ==========================================
            // ATUALIZA O DISPOSITIVO SELECIONADO
            // ==========================================

            const { data: updatedDevice, error: updateError } =
                await supabase
                    .from("devices")
                    .update({
                        mercadolivre_admin: novoStatus
                    })
                    .eq("id", id)
                    .select()
                    .single();


            if (updateError) {

                console.error(
                    "Erro ao definir ADM Mercado Livre:",
                    updateError
                );

                return res.status(500).json({
                    ok: false,
                    reason: "database_error"
                });

            }


            // ==========================================
            // REGISTRAR LOG
            // ==========================================

            await supabase
                .from("logs")
                .insert({

                    company_id:
                        device.company_id,

                    user_id:
                        device.user_id,

                    device_id:
                        device.id,

                    admin_id:
                        req.admin.admin_id,

                    acao:
                        novoStatus
                            ? "mercadolivre_admin_enabled"
                            : "mercadolivre_admin_disabled",

                    detalhes: {

                        device_identifier:
                            device.device_id,

                        device_name:
                            device.nome,

                        previous_value:
                            device.mercadolivre_admin,

                        new_value:
                            novoStatus

                    }

                });


            return res.json({

                ok: true,

                device: updatedDevice,

                message:
                    novoStatus
                        ? "Dispositivo definido como ADM do Mercado Livre."
                        : "ADM do Mercado Livre removido do dispositivo."

            });


        } catch (error) {

            console.error(
                "Erro inesperado ao definir ADM ML:",
                error
            );

            return res.status(500).json({
                ok: false,
                reason: "server_error"
            });

        }

    }
);

app.get("/api/admin/logs", verificarAdmin, async (req, res) => {
    try {
        const { data: logs, error } = await supabase
            .from("logs")
            .select(`
                *,
                companies (
                    id,
                    nome
                ),
                users (
                    id,
                    nome,
                    email
                ),
                devices (
                    id,
                    device_id,
                    nome,
                    status
                ),
                admins (
                    id,
                    nome,
                    email
                )
            `)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {
            console.error("Erro ao buscar logs:", error);

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        return res.json({
            ok: true,
            logs
        });

    } catch (error) {
        console.error("Erro inesperado:", error);

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });
    }
});

app.patch("/api/admin/devices/:id/name", verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({
                error: "Nome do dispositivo é obrigatório"
            });
        }

        const { data: existingDevice, error: deviceError } = await supabase
            .from("devices")
            .select("*")
            .eq("id", id)
            .single();

        if (deviceError || !existingDevice) {
            return res.status(404).json({
                error: "Dispositivo não encontrado"
            });
        }

        const nomeAntigo = existingDevice.nome;

        const { data: device, error } = await supabase
            .from("devices")
            .update({
                nome: nome.trim()
            })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error(error);

            return res.status(500).json({
                error: "Erro ao alterar nome do dispositivo"
            });
        }

        await supabase.from("logs").insert({
    company_id: existingDevice.company_id,
    user_id: existingDevice.user_id,
    device_id: id,
    admin_id: req.admin.admin_id,
    acao: "device_name_changed",
    detalhes: {
        device_identifier: existingDevice.device_id,
        old_name: nomeAntigo,
        new_name: nome.trim()
    }
});

        res.json({
            ok: true,
            device
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Erro interno do servidor"
        });
    }
});

app.use(express.json({
    type: ["application/json", "application/*+json", "text/plain"]
}));

app.post("/api/webhooks/asaas", async (req, res) => {
    console.log("=================================");
    console.log("WEBHOOK ASAAS RECEBIDO");
    console.log("CONTENT-TYPE:", req.headers["content-type"]);

    try {
        // Asaas envia o payload dentro do campo "data"
        const evento = JSON.parse(req.body.data);

        console.log("EVENTO:", evento.event);
        console.log("ID DO EVENTO:", evento.id);
        console.log("=================================");

        // Responde imediatamente ao Asaas
        res.status(200).json({
            received: true
        });

        const payment = evento.payment;

        if (!payment) {
            console.log("Evento sem payment.");
            return;
        }

        console.log("PAYMENT ID:", payment.id);
        console.log("STATUS:", payment.status);
        console.log("VALOR:", payment.value);
        console.log("CUSTOMER:", payment.customer);
        console.log("SUBSCRIPTION:", payment.subscription);
        console.log("CHECKOUT:", payment.checkoutSession);

        // ==========================================
        // PAGAMENTO CRIADO
        // ==========================================

        if (evento.event === "PAYMENT_CREATED") {
            console.log("Pagamento criado. Aguardando confirmação.");
            return;
        }

        // ==========================================
        // PAGAMENTO CONFIRMADO / RECEBIDO
        // ==========================================

        if (
            evento.event === "PAYMENT_CONFIRMED" ||
            evento.event === "PAYMENT_RECEIVED"
        ) {
            console.log("=================================");
            console.log("PAGAMENTO CONFIRMADO/RECEBIDO");
            console.log("PAYMENT:", payment.id);
            console.log("STATUS:", payment.status);
            console.log("=================================");

            // Aqui entraremos com:
            // 1. Idempotência
            // 2. Identificação do plano
            // 3. Criação da empresa
            // 4. Criação da licença
            // 5. Criação do usuário
            // 6. Registro do pagamento
            // 7. Registro do log

            return;
        }

        console.log("Evento recebido, mas ainda não processado:", evento.event);

    } catch (error) {
        console.error("Erro ao processar webhook Asaas:");
        console.error(error);

        // Mesmo com erro interno, não queremos ficar
        // devolvendo erro para o Asaas durante os testes.
        if (!res.headersSent) {
            res.status(200).json({
                received: true
            });
        }
    }
});

app.get("/api/asaas-status", async (req, res) => {
    try {
        const response = await axios.get(
            `${process.env.ASAAS_API_URL}/myAccount/status/`,
            {
                headers: {
                    access_token: process.env.ASAAS_API_KEY
                }
            }
        );

        res.json({
            ok: true,
            status: response.data
        });

    } catch (error) {
        console.error(
            "Erro status Asaas:",
            error.response?.data || error.message
        );

        res.status(500).json({
            ok: false,
            error: error.response?.data || error.message
        });
    }
});

// ==========================================
// CONSULTAR STATUS DA LICENÇA
// ==========================================

app.post("/api/license/status", async (req, res) => {
  try {
    const { chave, device_id } = req.body;

    if (!chave || !device_id) {
      return res.status(400).json({
        authorized: false,
        reason: "missing_data",
        status: "unknown"
      });
    }

    // ==========================================
    // BUSCAR LICENÇA
    // ==========================================

    const { data: license, error: licenseError } = await supabase
      .from("licenses")
      .select("*")
      .eq("chave", chave)
      .maybeSingle();

    if (licenseError) {
      console.error("Erro ao buscar licença:", licenseError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error",
        status: "unknown"
      });
    }

    if (!license) {
      return res.status(404).json({
        authorized: false,
        reason: "invalid_license",
        status: "invalid"
      });
    }

    // ==========================================
    // BUSCAR EMPRESA
    // ==========================================

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, nome, status")
      .eq("id", license.company_id)
      .maybeSingle();

    if (companyError) {
      console.error("Erro ao buscar empresa:", companyError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error",
        status: "unknown"
      });
    }

    if (!company) {
      return res.status(404).json({
        authorized: false,
        reason: "company_not_found",
        status: "unknown"
      });
    }

    // ==========================================
    // VERIFICAR EMPRESA
    // ==========================================

    if (company.status !== "active") {
      return res.json({
        authorized: false,
        reason: "company_inactive",
        status: "inactive",
        company: company.nome,
        company_id: company.id,
        device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // VERIFICAR LICENÇA
    // ==========================================

    if (license.status !== "active") {
      return res.json({
        authorized: false,
        reason: "license_inactive",
        status: license.status,
        company: company.nome,
        company_id: company.id,
        device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // VERIFICAR VENCIMENTO
    // ==========================================

    if (
      license.vencimento &&
      new Date(license.vencimento).getTime() < Date.now()
    ) {
      return res.json({
        authorized: false,
        reason: "license_expired",
        status: "expired",
        company: company.nome,
        company_id: company.id,
        device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // BUSCAR DISPOSITIVO
    // ==========================================

    const { data: device, error: deviceError } = await supabase
  .from("devices")
  .select(`
    *,
    users (
      id,
      nome,
      email,
      status
    )
  `)
  .eq("company_id", license.company_id)
  .eq("device_id", device_id)
  .maybeSingle();

    if (deviceError) {
      console.error("Erro ao buscar dispositivo:", deviceError);

      return res.status(500).json({
        authorized: false,
        reason: "database_error",
        status: "unknown"
      });
    }

    // ==========================================
    // NÃO ATIVADO
    // ==========================================

    if (!device) {
      return res.json({
        authorized: false,
        reason: "not_activated",
        status: "not_activated",
        company: company.nome,
        company_id: company.id,
        device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // DISPOSITIVO BLOQUEADO
    // ==========================================

    if (device.status === "blocked") {
      return res.json({
        authorized: false,
        reason: "device_blocked",
        status: "blocked",
        company: company.nome,
        company_id: company.id,
        device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // DISPOSITIVO REMOVIDO
    // ==========================================

    if (device.status === "removed") {
      return res.json({
        authorized: false,
        reason: "device_removed",
        status: "removed",
        company: company.nome,
        company_id: company.id,
        device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // ATIVO
    // ==========================================

    if (device.status === "active") {
      return res.json({
        authorized: true,
        reason: "active",
        status: "active",
        company: company.nome,
        company_id: company.id,
        device_id: device.device_id,
        license_expires_at: license.vencimento
      });
    }

    // ==========================================
    // STATUS DESCONHECIDO
    // ==========================================

    return res.json({
      authorized: false,
      reason: "unknown_status",
      status: device.status,
      company: company.nome,
      company_id: company.id,
      device_id: device.device_id,
      license_expires_at: license.vencimento
    });

  } catch (error) {
    console.error("Erro ao consultar status:", error);

    return res.status(500).json({
      authorized: false,
      reason: "server_error",
      status: "unknown"
    });
  }
});

// ==========================================
// 🔄 RECARREGAR DISPOSITIVO REMOTAMENTE
// ==========================================

app.post(
    "/api/admin/devices/:id/reload",
    verificarAdmin,
    async (req, res) => {

        try {

            const { id } = req.params;

            // Buscar dispositivo
            const { data: device, error } = await supabase
                .from("devices")
                .select("*")
                .eq("id", id)
                .maybeSingle();

            if (error) {
                console.error(
                    "Erro ao buscar dispositivo:",
                    error
                );

                return res.status(500).json({
                    ok: false,
                    reason: "database_error"
                });
            }

            if (!device) {
                return res.status(404).json({
                    ok: false,
                    reason: "device_not_found"
                });
            }

            // Procurar WebSocket desse dispositivo
            const socket = connectedDevices.get(
                device.device_id
            );

            // Dispositivo offline
            if (
                !socket ||
                socket.readyState !== 1
            ) {
                return res.status(409).json({
                    ok: false,
                    reason: "device_offline",
                    message: "Dispositivo offline"
                });
            }

            // Enviar comando
            socket.send(JSON.stringify({
                type: "reload"
            }));

            console.log(
                `🔄 Reload enviado para ${device.device_id}`
            );

            return res.json({
                ok: true,
                message: "Comando enviado"
            });

        } catch (error) {

            console.error(
                "Erro ao enviar reload:",
                error
            );

            return res.status(500).json({
                ok: false,
                reason: "server_error"
            });
        }
    }
);

// ============================================================
// MERCADO LIVRE - OAuth 2.0 + PKCE
// ============================================================

const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI;

// Estado temporário do OAuth
const mlOAuthStates = new Map();

// ============================================================
// MERCADO LIVRE - GERENCIADOR DE TOKEN
// ============================================================

const mlTokenRefreshPromises = new Map();

async function getValidMercadoLivreToken(companyId) {

    if (!companyId) {
        throw new Error("companyId é obrigatório");
    }

    const { data: account, error: accountError } =
        await supabase
            .from("mercadolivre_accounts")
            .select("*")
            .eq("company_id", companyId)
            .maybeSingle();

    if (accountError) {
        console.error(
            "❌ Erro ao buscar conta Mercado Livre:",
            accountError
        );

        throw new Error(
            "Erro ao buscar conta Mercado Livre"
        );
    }

    if (!account) {
    throw new Error(
        "Conta do Mercado Livre não conectada"
    );
}


    if (!account.access_token) {
        throw new Error(
            "Access token do Mercado Livre não encontrado"
        );
    }

    if (!account.refresh_token) {
        throw new Error(
            "Refresh token do Mercado Livre não encontrado"
        );
    }

    // ========================================================
    // VERIFICAR SE AINDA ESTÁ VÁLIDO
    // ========================================================

    const expiresAt =
        account.token_expires_at
            ? new Date(
                account.token_expires_at
            ).getTime()
            : 0;

    const agora = Date.now();

    // Renovar 5 minutos antes de expirar
    const margemRenovacao =
        5 * 60 * 1000;

    if (
        expiresAt > 0 &&
        agora < expiresAt - margemRenovacao
    ) {

        return account.access_token;
    }

    // ========================================================
    // EVITAR DUAS RENOVAÇÕES SIMULTÂNEAS
    // ========================================================

    if (mlTokenRefreshPromises.has(companyId)) {

        console.log(
            `⏳ Renovação ML já em andamento | Empresa: ${companyId}`
        );

        return await mlTokenRefreshPromises.get(
            companyId
        );
    }

    // ========================================================
    // CRIAR PROMISE DE RENOVAÇÃO
    // ========================================================

    const refreshPromise = (async () => {

        try {

            console.log(
                `🔄 Renovando token Mercado Livre | Empresa: ${companyId}`
            );

            const refreshResponse =
                await axios.post(

                    "https://api.mercadolibre.com/oauth/token",

                    new URLSearchParams({

                        grant_type:
                            "refresh_token",

                        client_id:
                            ML_CLIENT_ID,

                        client_secret:
                            ML_CLIENT_SECRET,

                        refresh_token:
                            account.refresh_token

                    }).toString(),

                    {
                        headers: {
                            accept:
                                "application/json",

                            "content-type":
                                "application/x-www-form-urlencoded"
                        }
                    }
                );

            const tokenData =
                refreshResponse.data;

            if (!tokenData.access_token) {

                throw new Error(
                    "Mercado Livre não retornou um novo access token"
                );
            }

            if (!tokenData.refresh_token) {

                throw new Error(
                    "Mercado Livre não retornou um novo refresh token"
                );
            }

            const expiresIn =
                Number(
                    tokenData.expires_in ||
                    21600
                );

            const tokenExpiresAt =
                new Date(
                    Date.now() +
                    expiresIn * 1000
                ).toISOString();

            // =================================================
            // SALVAR OS NOVOS TOKENS
            // =================================================

            const { error: updateError } =
                await supabase
                    .from("mercadolivre_accounts")
                    .update({

                        access_token:
                            tokenData.access_token,

                        refresh_token:
                            tokenData.refresh_token,

                        token_expires_at:
                            tokenExpiresAt,

                        scope:
                            tokenData.scope ||
                            account.scope ||
                            null,

                        updated_at:
                            new Date().toISOString()

                    })
                    .eq(
                        "company_id",
                        companyId
                    );

            if (updateError) {

                console.error(
                    "❌ Erro ao salvar novos tokens ML:",
                    updateError
                );

                throw new Error(
                    "Token renovado, mas não foi possível salvar no banco"
                );
            }

            console.log(
                `✅ Token Mercado Livre renovado | Empresa: ${companyId}`
            );

            return tokenData.access_token;

        } catch (error) {

            console.error(
                "❌ Erro ao renovar token Mercado Livre:",
                error.response?.data ||
                error.message
            );

            if (
                error.response?.data?.error ===
                "invalid_grant"
            ) {

                console.error(
                    `⚠️ Refresh token inválido/expirado | Empresa: ${companyId}`
                );

                throw new Error(
                    "A autorização do Mercado Livre expirou. É necessário conectar novamente."
                );
            }

            throw error;

        } finally {

            mlTokenRefreshPromises.delete(
                companyId
            );

        }

    })();

    mlTokenRefreshPromises.set(
        companyId,
        refreshPromise
    );

    return await refreshPromise;
}



// ============================================================
// MERCADO LIVRE - FUNÇÕES EXTRAS
// 🔬 RAIO-X + 💰 PREÇO IDEAL
// ============================================================

async function validarAcessoMercadoLivre(chave, device_id) {

    if (!chave || !device_id) {
        const error = new Error(
            "chave e device_id são obrigatórios"
        );

        error.statusCode = 400;
        error.reason = "missing_data";

        throw error;
    }


    // ========================================================
    // BUSCAR LICENÇA
    // ========================================================

    const { data: license, error: licenseError } =
        await supabase
            .from("licenses")
            .select("*")
            .eq("chave", chave)
            .maybeSingle();


    if (licenseError) {

        console.error(
            "Erro ao buscar licença ML:",
            licenseError
        );

        const error = new Error(
            "Erro ao consultar licença"
        );

        error.statusCode = 500;
        error.reason = "database_error";

        throw error;
    }


    if (!license) {

        const error = new Error(
            "Licença não encontrada"
        );

        error.statusCode = 404;
        error.reason = "invalid_license";

        throw error;
    }


    // ========================================================
    // VALIDAR LICENÇA
    // ========================================================

    if (license.status !== "active") {

        const error = new Error(
            "Licença não está ativa"
        );

        error.statusCode = 403;
        error.reason = "license_inactive";

        throw error;
    }


    if (
        license.vencimento &&
        new Date(license.vencimento).getTime() < Date.now()
    ) {

        const error = new Error(
            "Licença expirada"
        );

        error.statusCode = 403;
        error.reason = "license_expired";

        throw error;
    }


    // ========================================================
    // BUSCAR EMPRESA
    // ========================================================

    const { data: company, error: companyError } =
        await supabase
            .from("companies")
            .select("id, nome, status")
            .eq("id", license.company_id)
            .maybeSingle();


    if (companyError) {

        console.error(
            "Erro ao buscar empresa ML:",
            companyError
        );

        const error = new Error(
            "Erro ao consultar empresa"
        );

        error.statusCode = 500;
        error.reason = "database_error";

        throw error;
    }


    if (!company) {

        const error = new Error(
            "Empresa não encontrada"
        );

        error.statusCode = 404;
        error.reason = "company_not_found";

        throw error;
    }


    if (company.status !== "active") {

        const error = new Error(
            "Empresa não está ativa"
        );

        error.statusCode = 403;
        error.reason = "company_inactive";

        throw error;
    }


    // ========================================================
    // VALIDAR DISPOSITIVO
    // ========================================================

    const { data: device, error: deviceError } =
        await supabase
            .from("devices")
            .select("id, device_id, status, company_id")
            .eq("company_id", company.id)
            .eq("device_id", device_id)
            .maybeSingle();


    if (deviceError) {

        console.error(
            "Erro ao buscar dispositivo ML:",
            deviceError
        );

        const error = new Error(
            "Erro ao consultar dispositivo"
        );

        error.statusCode = 500;
        error.reason = "database_error";

        throw error;
    }


    if (!device) {

        const error = new Error(
            "Dispositivo não registrado"
        );

        error.statusCode = 403;
        error.reason = "device_not_registered";

        throw error;
    }


    if (device.status !== "active") {

        const error = new Error(
            "Dispositivo não está ativo"
        );

        error.statusCode = 403;
        error.reason = "device_inactive";

        throw error;
    }


    return {
        license,
        company,
        device
    };
}


// ============================================================
// 🔬 RAIO-X DO ANÚNCIO
// ============================================================

app.get("/api/mercadolivre/rx", async (req, res) => {

    try {

        const {
            chave,
            device_id,
            item_id
        } = req.query;


        // ====================================================
        // VALIDAR ITEM
        // ====================================================

        if (!item_id) {

            return res.status(400).json({
                ok: false,
                reason: "missing_item_id",
                message: "item_id é obrigatório"
            });

        }


        const itemId = String(item_id)
            .trim()
            .toUpperCase();


        if (!/^MLB\d+$/i.test(itemId)) {

            return res.status(400).json({
                ok: false,
                reason: "invalid_item_id",
                message: "Informe um item_id válido, exemplo: MLB123456789"
            });

        }


        // ====================================================
        // VALIDAR ACESSO
        // ====================================================

        const {
            company
        } = await validarAcessoMercadoLivre(
            chave,
            device_id
        );


        // ====================================================
        // TOKEN VÁLIDO
        // ====================================================

        const accessToken =
            await getValidMercadoLivreToken(
                company.id
            );


        const headers = {
            Authorization:
                `Bearer ${accessToken}`
        };


        // ====================================================
        // CONSULTAR ITEM
        // ====================================================

        const itemResponse =
            await axios.get(
                `https://api.mercadolibre.com/items/${itemId}`,
                {
                    headers
                }
            );


        const item =
            itemResponse.data;


            
        // ====================================================
// CONSULTAR PERFORMANCE
// ====================================================

let performance = null;
let performanceError = null;

// Verifica se o anúncio está relacionado a catálogo
const isCatalogItem =
    item.catalog_listing === true ||
    !!item.catalog_product_id;

// Só tenta consultar performance quando não for Product item
if (!isCatalogItem) {

    try {

        const performanceResponse =
            await axios.get(
                `https://api.mercadolibre.com/item/${itemId}/performance`,
                {
                    headers
                }
            );

        performance =
            performanceResponse.data;

    } catch (error) {

        performanceError = {
            status:
                error.response?.status || 500,

            message:
                error.response?.data?.message ||
                error.message
        };

        console.warn(
            "⚠️ Não foi possível consultar performance ML:",
            performanceError
        );
    }

} else {

    performanceError = {
        status: null,
        reason: "product_item_not_supported",
        message:
            "Este anúncio é um Product item e não possui performance disponível neste endpoint."
    };

    
}

        // ====================================================
        // CONSULTAR DESCRIÇÃO
        // ====================================================

        let description = null;


        try {

            const descriptionResponse =
                await axios.get(
                    `https://api.mercadolibre.com/items/${itemId}/description`,
                    {
                        headers
                    }
                );


            description =
                descriptionResponse.data;

        } catch (error) {

            console.warn(
                "⚠️ Não foi possível consultar descrição:",
                error.response?.data ||
                error.message
            );

        }


        // ====================================================
        // ANÁLISE DO ANÚNCIO
        // ====================================================

        const titulo =
            String(item.title || "").trim();


        const imagens =
            Array.isArray(item.pictures)
                ? item.pictures
                : [];


        const atributos =
            Array.isArray(item.attributes)
                ? item.attributes
                : [];


        const descricaoTexto =
            description?.plain_text ||
            description?.text ||
            "";


        const tags =
            Array.isArray(item.tags)
                ? item.tags
                : [];


        const diagnostico = {

            titulo: {
                valor: titulo,
                caracteres: titulo.length,
                preenchido: titulo.length > 0
            },

            imagens: {
                quantidade: imagens.length,
                preenchido: imagens.length > 0
            },

            descricao: {
                preenchida:
                    descricaoTexto.trim().length > 0,

                caracteres:
                    descricaoTexto.trim().length
            },

            atributos: {
                quantidade: atributos.length
            },

            vendas: {
                quantidade:
                    item.sold_quantity ?? null
            },

            estoque: {
                disponivel:
                    item.available_quantity ?? null
            },

            tags,

            categoria:
                item.category_id || null,

            tipo_anuncio:
                item.listing_type_id || null,

            condicao:
                item.item_condition ||
                item.condition ||
                null

        };


        // ====================================================
        // OBJETIVOS PENDENTES DO MERCADO LIVRE
        // ====================================================

        const pendencias = [];


        if (performance?.buckets) {

            for (
                const bucket
                of performance.buckets
            ) {

                const variables =
                    Array.isArray(bucket.variables)
                        ? bucket.variables
                        : [];


                for (
                    const variable
                    of variables
                ) {

                    const rules =
                        Array.isArray(variable.rules)
                            ? variable.rules
                            : [];


                    for (
                        const rule
                        of rules
                    ) {

                        if (
                            String(rule.status || "")
                                .toUpperCase() ===
                            "PENDING"
                        ) {

                            pendencias.push({

                                bucket:
                                    bucket.key ||
                                    null,

                                variable:
                                    variable.key ||
                                    variable.name ||
                                    null,

                                rule:
                                    rule.key ||
                                    rule.name ||
                                    null,

                                status:
                                    rule.status,

                                mode:
                                    rule.mode ||
                                    null,

                                link:
                                    rule.link ||
                                    null

                            });

                        }

                    }

                }

            }

        }


        // ====================================================
        // RESPOSTA
        // ====================================================

        return res.json({

            ok: true,

            item_id:
                item.id,

            anuncio: {

                id:
                    item.id,

                titulo:
                    item.title,

                categoria:
                    item.category_id,

                preco:
                    item.price,

                moeda:
                    item.currency_id,

                quantidade_vendida:
                    item.sold_quantity,

                estoque:
                    item.available_quantity,

                status:
                    item.status,

                tipo_anuncio:
                    item.listing_type_id,

                permalink:
                    item.permalink

            },

            diagnostico,

            performance: performance
                ? {

                    score:
                        performance.score ?? null,

                    level:
                        performance.level ?? null,

                    level_wording:
                        performance.level_wording ?? null,

                    calculated_at:
                        performance.calculated_at ?? null,

                    pendencias

                }
                : null,

            performance_error:
                performanceError,

            descricao: {

                disponivel:
                    !!description,

                caracteres:
                    descricaoTexto.length

            },

            analise: {

                titulo_ok:
                    titulo.length > 0,

                imagens_ok:
                    imagens.length > 0,

                descricao_ok:
                    descricaoTexto.trim().length > 0,

                possui_pendencias:
                    pendencias.length > 0,

                quantidade_pendencias:
                    pendencias.length

            }

        });


    } catch (error) {

        console.error(
            "❌ Erro no Raio-X ML:",
            error.response?.data ||
            error.message ||
            error
        );


        if (error.statusCode) {

            return res.status(
                error.statusCode
            ).json({

                ok: false,

                reason:
                    error.reason,

                message:
                    error.message

            });

        }


        if (error.response) {

            return res.status(
                error.response.status || 500
            ).json({

                ok: false,

                reason:
                    "mercadolivre_api_error",

                message:
                    error.response.data?.message ||
                    "Erro ao consultar Mercado Livre",

                details:
                    error.response.data || null

            });

        }


        return res.status(500).json({

            ok: false,

            reason: "server_error",

            message:
                error.message ||
                "Erro interno do servidor"

        });

    }

});


// ============================================================
// 💰 PREÇO IDEAL
// ============================================================

app.get("/api/mercadolivre/preco", async (req, res) => {

    try {

        const {
            chave,
            device_id,
            item_id
        } = req.query;


        // ====================================================
        // VALIDAR ITEM
        // ====================================================

        if (!item_id) {

            return res.status(400).json({
                ok: false,
                reason: "missing_item_id",
                message: "item_id é obrigatório"
            });

        }


        const itemId =
            String(item_id)
                .trim()
                .toUpperCase();


        if (!/^MLB\d+$/i.test(itemId)) {

            return res.status(400).json({
                ok: false,
                reason: "invalid_item_id",
                message:
                    "Informe um item_id válido, exemplo: MLB123456789"
            });

        }


        // ====================================================
        // VALIDAR ACESSO
        // ====================================================

        const {
            company
        } = await validarAcessoMercadoLivre(
            chave,
            device_id
        );


        // ====================================================
        // TOKEN
        // ====================================================

        const accessToken =
            await getValidMercadoLivreToken(
                company.id
            );


        const headers = {
            Authorization:
                `Bearer ${accessToken}`
        };


        // ====================================================
        // BUSCAR DADOS DO ANÚNCIO
        // ====================================================

        const itemResponse =
            await axios.get(
                `https://api.mercadolibre.com/items/${itemId}`,
                {
                    headers
                }
            );


        const item =
            itemResponse.data;


        const titulo =
            item.title || null;

        const categoria =
            item.category_id || null;

        const sellerId =
            item.seller_id || null;


        // ====================================================
        // PREÇO ATUAL
        // ====================================================

        const pricesResponse =
            await axios.get(
                `https://api.mercadolibre.com/items/${itemId}/prices`,
                {
                    headers
                }
            );


        const pricesData =
            pricesResponse.data;


        const listaPrecos =
            Array.isArray(pricesData?.prices)
                ? pricesData.prices
                : [];


        const precoStandard =
            listaPrecos.find(
                price =>
                    price.type === "standard"
            ) || null;


        const precoPromocional =
            listaPrecos.find(
                price =>
                    price.type === "promotion"
            ) || null;


        const precoAtual =
            precoPromocional?.amount ??
            precoStandard?.amount ??
            item.price ??
            null;


        // ====================================================
        // SUGESTÃO OFICIAL DO MERCADO LIVRE
        // ====================================================

        let reference = null;

        let referenceError = null;


        try {

            const referenceResponse =
                await axios.get(
                    `https://api.mercadolibre.com/suggestions/items/${itemId}/details`,
                    {
                        headers
                    }
                );


            reference =
                referenceResponse.data;


        } catch (error) {

            referenceError = {

                status:
                    error.response?.status ||
                    500,

                message:
                    error.response?.data?.message ||
                    error.message

            };


            console.warn(
                "⚠️ Sugestão oficial indisponível:",
                referenceError
            );

        }


        // ====================================================
        // BUSCAR CONCORRENTES
        // ====================================================

        let concorrentes = [];

        let concorrentesError = null;


        try {

            if (titulo && categoria) {

                const searchResponse =
                    await axios.get(
                        "https://api.mercadolibre.com/sites/MLB/search",
                        {
                            headers,

                            params: {

                                q: titulo,

                                category: categoria,

                                limit: 20,

                                sort: "price_asc"

                            }

                        }
                    );


                const resultados =
                    Array.isArray(
                        searchResponse.data?.results
                    )
                        ? searchResponse.data.results
                        : [];


                concorrentes =
                    resultados

                        // Não considerar o próprio anúncio
                        .filter(
                            anuncio =>
                                anuncio.id !== itemId
                        )

                        // Não considerar anúncios do próprio vendedor
                        .filter(
                            anuncio =>
                                !sellerId ||
                                anuncio.seller?.id !== sellerId
                        )

                        // Somente anúncios com preço válido
                        .filter(
                            anuncio =>
                                Number.isFinite(
                                    Number(anuncio.price)
                                ) &&
                                Number(anuncio.price) > 0
                        )

                        .slice(0, 15)

                        .map(anuncio => ({

                            id:
                                anuncio.id,

                            titulo:
                                anuncio.title,

                            preco:
                                Number(anuncio.price),

                            vendedor:
                                anuncio.seller?.id ||
                                null,

                            link:
                                anuncio.permalink ||
                                null

                        }));

            }

        } catch (error) {

            concorrentesError = {

                status:
                    error.response?.status ||
                    500,

                message:
                    error.response?.data?.message ||
                    error.message

            };


            console.warn(
                "⚠️ Erro ao buscar concorrentes:",
                concorrentesError
            );

        }


        // ====================================================
        // CALCULAR REFERÊNCIA DOS CONCORRENTES
        // ====================================================

        const precosConcorrentes =
            concorrentes
                .map(
                    concorrente =>
                        Number(concorrente.preco)
                )
                .filter(
                    preco =>
                        Number.isFinite(preco) &&
                        preco > 0
                )
                .sort(
                    (a, b) =>
                        a - b
                );


        let concorrenteMenor =
            null;

        let concorrenteMaior =
            null;

        let concorrenteMedia =
            null;

        let concorrenteMediana =
            null;


        if (precosConcorrentes.length > 0) {

            concorrenteMenor =
                precosConcorrentes[0];


            concorrenteMaior =
                precosConcorrentes[
                    precosConcorrentes.length - 1
                ];


            const soma =
                precosConcorrentes.reduce(
                    (
                        total,
                        preco
                    ) =>
                        total + preco,
                    0
                );


            concorrenteMedia =
                soma /
                precosConcorrentes.length;


            const meio =
                Math.floor(
                    precosConcorrentes.length / 2
                );


            if (
                precosConcorrentes.length % 2 === 0
            ) {

                concorrenteMediana =
                    (
                        precosConcorrentes[meio - 1] +
                        precosConcorrentes[meio]
                    ) / 2;

            } else {

                concorrenteMediana =
                    precosConcorrentes[meio];

            }

        }


        // ====================================================
        // CALCULAR DIFERENÇA PARA A MEDIANA
        // ====================================================

        let diferencaPercentual =
            null;


        if (
            precoAtual !== null &&
            concorrenteMediana !== null &&
            concorrenteMediana > 0
        ) {

            diferencaPercentual =
                (
                    (
                        precoAtual -
                        concorrenteMediana
                    ) /
                    concorrenteMediana
                ) *
                100;

        }


        // ====================================================
        // RESPOSTA
        // ====================================================

        return res.json({

            ok: true,

            item_id:
                itemId,


            atual: {

                standard:
                    precoStandard
                        ? {

                            amount:
                                precoStandard.amount,

                            currency_id:
                                precoStandard.currency_id,

                            regular_amount:
                                precoStandard.regular_amount,

                            last_updated:
                                precoStandard.last_updated

                        }
                        : null,


                promotion:
                    precoPromocional
                        ? {

                            amount:
                                precoPromocional.amount,

                            currency_id:
                                precoPromocional.currency_id,

                            regular_amount:
                                precoPromocional.regular_amount,

                            last_updated:
                                precoPromocional.last_updated

                        }
                        : null,

                amount:
                    precoAtual

            },


            referencia: reference
                ? {

                    status:
                        reference.status ||
                        null,

                    ratio:
                        reference.ratio ??
                        null,

                    current_price:
                        reference.current_price ||
                        null,

                    suggested_price:
                        reference.suggested_price ||
                        null,

                    lowest_price:
                        reference.lowest_price ||
                        null,

                    internal_price:
                        reference.internal_price ||
                        null,

                    costs:
                        reference.costs ||
                        null,

                    applicable_suggestion:
                        reference.applicable_suggestion ??
                        null,

                    percent_difference:
                        reference.percent_difference ??
                        null,

                    compared_values:
                        reference.compared_values ??
                        null,

                    last_updated:
                        reference.last_updated ||
                        null

                }
                : null,


            referencia_error:
                referenceError,


            informacoes: {

                titulo:
                    titulo,

                vendas:
                    item.sold_quantity ??
                    null,

                categoria:
                    categoria,

                vendedor:
                    sellerId

            },


            concorrencia: {

                quantidade:
                    concorrentes.length,

                menor_preco:
                    concorrenteMenor,

                maior_preco:
                    concorrenteMaior,

                media:
                    concorrenteMedia,

                mediana:
                    concorrenteMediana,

                diferenca_percentual:
                    diferencaPercentual,

                concorrentes:
                    concorrentes

            },


            concorrentes_error:
                concorrentesError

        });


    } catch (error) {

        console.error(
            "❌ Erro no Preço Ideal ML:",
            error.response?.data ||
            error.message
        );


        return res.status(
            error.response?.status || 500
        ).json({

            ok: false,

            reason:
                "mercadolivre_api_error",

            message:
                error.response?.data?.message ||
                error.message ||
                "Erro ao consultar preço"

        });

    }

});

function generateCodeVerifier() {
    return crypto.randomBytes(64).toString("base64url");
}

function generateCodeChallenge(codeVerifier) {
    return crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
}


// ============================================================
// INICIAR AUTORIZAÇÃO
// ============================================================

app.get("/api/mercadolivre/auth", async (req, res) => {

    try {

        const { chave, device_id } = req.query;

        if (!chave || !device_id) {
            return res.status(400).json({
                ok: false,
                reason: "missing_data",
                message: "chave e device_id são obrigatórios"
            });
        }

        if (!ML_CLIENT_ID || !ML_CLIENT_SECRET || !ML_REDIRECT_URI) {
            return res.status(500).json({
                ok: false,
                reason: "oauth_not_configured"
            });
        }


        // ====================================================
        // BUSCAR LICENÇA
        // ====================================================

        const { data: license, error: licenseError } = await supabase
            .from("licenses")
            .select("*")
            .eq("chave", chave)
            .maybeSingle();

        if (licenseError) {
            console.error(
                "Erro ao buscar licença para OAuth:",
                licenseError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!license) {
            return res.status(404).json({
                ok: false,
                reason: "invalid_license"
            });
        }


        // ====================================================
        // VALIDAR LICENÇA
        // ====================================================

        if (license.status !== "active") {
            return res.status(403).json({
                ok: false,
                reason: "license_inactive"
            });
        }

        if (
            license.vencimento &&
            new Date(license.vencimento).getTime() < Date.now()
        ) {
            return res.status(403).json({
                ok: false,
                reason: "license_expired"
            });
        }


        // ====================================================
        // BUSCAR EMPRESA
        // ====================================================

        const { data: company, error: companyError } = await supabase
            .from("companies")
            .select("id, nome, status")
            .eq("id", license.company_id)
            .maybeSingle();

        if (companyError) {
            console.error(
                "Erro ao buscar empresa para OAuth:",
                companyError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!company) {
            return res.status(404).json({
                ok: false,
                reason: "company_not_found"
            });
        }

        if (company.status !== "active") {
            return res.status(403).json({
                ok: false,
                reason: "company_inactive"
            });
        }


        // ====================================================
        // VALIDAR DISPOSITIVO
        // ====================================================

       const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, device_id, status, company_id, mercadolivre_admin")
    .eq("company_id", company.id)
    .eq("device_id", device_id)
    .maybeSingle();

        if (deviceError) {
            console.error(
                "Erro ao buscar dispositivo para OAuth:",
                deviceError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });
        }

        if (!device) {
            return res.status(403).json({
                ok: false,
                reason: "device_not_registered",
                message: "Dispositivo não está registrado nesta licença"
            });
        }

        if (device.status !== "active") {
            return res.status(403).json({
                ok: false,
                reason: "device_inactive",
                message: "Dispositivo não está ativo"
            });
        }
        // ====================================================
// SOMENTE ADM PODE CONECTAR O MERCADO LIVRE
// ====================================================

if (device.mercadolivre_admin !== true) {
    return res.status(403).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">

            <title>Mercado Livre — ML SH Support</title>

            <style>
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }

                body {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    font-family: Arial, Helvetica, sans-serif;
                    background:
                        radial-gradient(
                            circle at top,
                            #eef2ff 0%,
                            #f8fafc 45%,
                            #ffffff 100%
                        );
                    color: #111827;
                }

                .card {
                    width: 100%;
                    max-width: 470px;
                    background: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 20px;
                    padding: 38px 32px;
                    text-align: center;
                    box-shadow:
                        0 20px 50px rgba(15, 23, 42, .10);
                }

                .icon {
                    width: 76px;
                    height: 76px;
                    margin: 0 auto 22px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 22px;
                    background: #fff7ed;
                    font-size: 38px;
                }

                .brand {
                    font-size: 13px;
                    font-weight: 700;
                    color: #6b7280;
                    letter-spacing: .5px;
                    margin-bottom: 10px;
                }

                h1 {
                    font-size: 24px;
                    margin-bottom: 12px;
                }

                .description {
                    color: #6b7280;
                    font-size: 14px;
                    line-height: 1.6;
                    margin-bottom: 24px;
                }

                .notice {
                    text-align: left;
                    padding: 15px;
                    border-radius: 12px;
                    background: #f8fafc;
                    border: 1px solid #e5e7eb;
                    margin-bottom: 24px;
                }

                .notice-title {
                    font-size: 13px;
                    font-weight: 700;
                    margin-bottom: 6px;
                }

                .notice-text {
                    font-size: 12px;
                    line-height: 1.5;
                    color: #6b7280;
                }

                .button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    padding: 13px 18px;
                    border: 0;
                    border-radius: 10px;
                    background: #111827;
                    color: white;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                }

                .button:hover {
                    background: #1f2937;
                }

                .footer {
                    margin-top: 20px;
                    font-size: 11px;
                    color: #9ca3af;
                }
            </style>
        </head>

        <body>

            <div class="card">

                <div class="icon">
                    🛒
                </div>

                <div class="brand">
                    ML SH SUPPORT
                </div>

                <h1>
                    Acesso não autorizado
                </h1>

                <div class="description">
                    Este dispositivo não possui permissão para
                    conectar a conta do Mercado Livre da empresa.
                </div>

                <div class="notice">
                    <div class="notice-title">
                        🔐 Conexão restrita ao Administrador da empresa.
                    </div>

                    <div class="notice-text">
                        A conexão da conta Mercado Livre deve ser
                        realizada pelo dispositivo definido como
                        <strong>Administrador do Mercado Livre</strong>
                        no painel administrativo.
                    </div>
                </div>

               <button
    class="button"
    onclick="window.close()"
>
    ← Voltar
</button>

                <div class="footer">
                    ML Support • Mercado Livre
                </div>

            </div>

        </body>
        </html>
    `);
}

        // ====================================================
        // GERAR PKCE
        // ====================================================

        const state = crypto.randomBytes(32).toString("hex");

        const codeVerifier = generateCodeVerifier();

        const codeChallenge =
            generateCodeChallenge(codeVerifier);


        // Guardamos temporariamente os dados necessários
        mlOAuthStates.set(state, {

            codeVerifier,

            companyId: company.id,

            companyName: company.nome,

            licenseKey: chave,

            deviceId: device_id,

            createdAt: Date.now()

        });


        // ====================================================
        // URL DO MERCADO LIVRE
        // ====================================================

        const params = new URLSearchParams({

            response_type: "code",

            client_id: ML_CLIENT_ID,

            redirect_uri: ML_REDIRECT_URI,

            state,

            code_challenge: codeChallenge,

            code_challenge_method: "S256"

        });


        const authorizationUrl =
            `https://auth.mercadolivre.com.br/authorization?${params.toString()}`;


        console.log(
            `🛒 ML OAuth iniciado | Empresa: ${company.nome} | Dispositivo: ${device_id}`
        );


        return res.redirect(authorizationUrl);


    } catch (error) {

        console.error(
            "Erro ao iniciar OAuth Mercado Livre:",
            error
        );

        return res.status(500).json({
            ok: false,
            reason: "server_error"
        });

    }

});


// ============================================================
// CALLBACK
// ============================================================

app.get("/api/mercadolivre/callback", async (req, res) => {

    try {

        const {
            code,
            state,
            error,
            error_description
        } = req.query;


        // ====================================================
        // USUÁRIO RECUSOU
        // ====================================================

        if (error) {

            console.error(
                "Mercado Livre OAuth recusado:",
                error,
                error_description
            );

            return res.status(400).send(`
                <h2>Autorização não concluída</h2>
                <p>${error_description || error}</p>
            `);

        }


        if (!code || !state) {

            return res.status(400).send(
                "Código ou state ausente."
            );

        }


        // ====================================================
        // RECUPERAR ESTADO
        // ====================================================

        const oauthData = mlOAuthStates.get(state);


        if (!oauthData) {

            return res.status(400).send(
                "Sessão OAuth inválida ou expirada."
            );

        }


        // State só pode ser usado uma vez
        mlOAuthStates.delete(state);


        // ====================================================
        // VALIDAR EXPIRAÇÃO DO STATE
        // ====================================================

        if (
            Date.now() - oauthData.createdAt >
            10 * 60 * 1000
        ) {

            return res.status(400).send(
                "Sessão OAuth expirada."
            );

        }


        // ====================================================
        // TROCAR CODE POR TOKEN
        // ====================================================

        const tokenResponse = await axios.post(

            "https://api.mercadolibre.com/oauth/token",

            new URLSearchParams({

                grant_type: "authorization_code",

                client_id: ML_CLIENT_ID,

                client_secret: ML_CLIENT_SECRET,

                code,

                redirect_uri: ML_REDIRECT_URI,

                code_verifier: oauthData.codeVerifier

            }).toString(),

            {

                headers: {

                    "accept": "application/json",

                    "content-type":
                        "application/x-www-form-urlencoded"

                }

            }

        );


        const tokenData = tokenResponse.data;


        console.log(
            "✅ ML OAuth concluído"
        );

        console.log(
            "ML User ID:",
            tokenData.user_id
        );

        console.log(
            "ML Scope:",
            tokenData.scope
        );


        // ====================================================
        // CONSULTAR CONTA
        // ====================================================

        const userResponse = await axios.get(

            "https://api.mercadolibre.com/users/me",

            {

                headers: {

                    Authorization:
                        `Bearer ${tokenData.access_token}`

                }

            }

        );


        const mlUser = userResponse.data;


        console.log(
            "ML Conta:",
            mlUser.nickname
        );


        // ====================================================
        // CALCULAR EXPIRAÇÃO
        // ====================================================

        const expiresIn =
            Number(tokenData.expires_in || 0);

        const tokenExpiresAt =
            new Date(
                Date.now() +
                expiresIn * 1000
            ).toISOString();


        // ====================================================
        // SALVAR NO SUPABASE
        // ====================================================

        const { data: account, error: accountError } =

            await supabase

                .from("mercadolivre_accounts")

                .upsert({

                    company_id:
                        oauthData.companyId,

                    ml_user_id:
                        tokenData.user_id,

                    nickname:
                        mlUser.nickname || null,

                    access_token:
                        tokenData.access_token,

                    refresh_token:
                        tokenData.refresh_token,

                    token_expires_at:
                        tokenExpiresAt,

                    scope:
                        tokenData.scope || null,

                    updated_at:
                        new Date().toISOString()

                }, {

                    onConflict:
                        "company_id"

                })

                .select()

                .single();


        if (accountError) {

            console.error(
                "❌ Erro ao salvar conta Mercado Livre:",
                accountError
            );

            return res.status(500).send(`
                <h2>Erro ao salvar conexão</h2>
                <p>A autorização foi concluída, mas não foi possível salvar a conta.</p>
            `);

        }


        console.log(
            `✅ Conta ML salva | Empresa: ${oauthData.companyName} | ML: ${mlUser.nickname}`
        );


        // ====================================================
        // REGISTRAR LOG
        // ====================================================

        await supabase
            .from("logs")
            .insert({

                company_id:
                    oauthData.companyId,

                device_id:
                    oauthData.deviceId,

                acao:
                    "mercadolivre_connected",

                detalhes: {

                    ml_user_id:
                        tokenData.user_id,

                    nickname:
                        mlUser.nickname,

                    scope:
                        tokenData.scope,

                    device_identifier:
                        oauthData.deviceId

                }

            });


        // ====================================================
        // SUCESSO
        // ====================================================

        res.send(`

            <!DOCTYPE html>

            <html lang="pt-BR">

            <head>

                <meta charset="UTF-8">

                <title>Mercado Livre conectado</title>

                <style>

                    body {

                        font-family: Arial, sans-serif;

                        background: #f5f7fa;

                        display: flex;

                        justify-content: center;

                        align-items: center;

                        height: 100vh;

                        margin: 0;

                    }

                    .box {

                        background: white;

                        padding: 35px;

                        border-radius: 14px;

                        box-shadow:
                            0 5px 25px rgba(0,0,0,.1);

                        text-align: center;

                        max-width: 450px;

                    }

                    h1 {

                        color: #16a34a;

                    }

                    .info {

                        margin-top: 20px;

                        padding: 15px;

                        background: #f5f7fa;

                        border-radius: 8px;

                    }

                </style>

            </head>

            <body>

                <div class="box">

                    <h1>
                        ✓ Mercado Livre conectado!
                    </h1>

                    <p>
                        Sua conta foi vinculada
                        à sua empresa.
                    </p>

                    <div class="info">

                        <strong>Conta:</strong><br>

                        ${mlUser.nickname || "N/A"}

                        <br><br>

                        <strong>ID:</strong><br>

                        ${mlUser.id}

                    </div>

                    <p>
                        Você pode fechar esta janela.
                    </p>

                </div>

            </body>

            </html>

        `);


    } catch (error) {

        console.error(

            "❌ ML OAuth callback error:",

            error.response?.data ||
            error.message

        );


        res.status(500).send(`

            <h2>
                Erro ao conectar ao Mercado Livre
            </h2>

            <p>
                Verifique os logs do servidor.
            </p>

        `);

    }

});


// ============================================================
// STATUS DA CONFIGURAÇÃO
// ============================================================

app.get("/api/mercadolivre/status", async (req, res) => {

    try {

        const {
            chave,
            device_id
        } = req.query;


        if (!chave || !device_id) {

            return res.json({

                configured: !!(
                    ML_CLIENT_ID &&
                    ML_CLIENT_SECRET &&
                    ML_REDIRECT_URI
                ),

                connected: false,

                message:
                    "chave e device_id são necessários"

            });

        }


        // Buscar licença
        const { data: license } =
            await supabase

                .from("licenses")

                .select("company_id")

                .eq("chave", chave)

                .maybeSingle();


        if (!license) {

            return res.status(404).json({

                connected: false,

                reason:
                    "invalid_license"

            });

        }


        // Buscar conta ML
        const { data: account, error } =
            await supabase

                .from("mercadolivre_accounts")

                .select(
                    "ml_user_id, nickname, token_expires_at, scope"
                )

                .eq(
                    "company_id",
                    license.company_id
                )

                .maybeSingle();


        if (error) {

            console.error(
                "Erro ao consultar conta ML:",
                error
            );

            return res.status(500).json({

                connected: false,

                reason:
                    "database_error"

            });

        }

        // ====================================================
// IDENTIFICAR SE O DISPOSITIVO É ADM
// ====================================================

const { data: device, error: deviceError } =
    await supabase
        .from("devices")
        .select(
            "id, device_id, status, mercadolivre_admin"
        )
        .eq(
            "company_id",
            license.company_id
        )
        .eq(
            "device_id",
            device_id
        )
        .maybeSingle();

if (deviceError) {
    console.error(
        "Erro ao consultar dispositivo ML:",
        deviceError
    );

    return res.status(500).json({
        connected: false,
        reason: "database_error"
    });
}

if (!device) {
    return res.status(403).json({
        connected: false,
        reason: "device_not_registered"
    });
}

if (device.status !== "active") {
    return res.status(403).json({
        connected: false,
        reason: "device_inactive"
    });
}

        return res.json({
    configured: !!(
        ML_CLIENT_ID &&
        ML_CLIENT_SECRET &&
        ML_REDIRECT_URI
    ),

    connected: !!account,

    is_admin: device.mercadolivre_admin === true,

    can_connect: device.mercadolivre_admin === true,

    company: {
        name: license.company_id
    },

    account: account
        ? {
            ml_user_id:
                account.ml_user_id,

            nickname:
                account.nickname,

            token_expires_at:
                account.token_expires_at,

            scope:
                account.scope
        }
        : null
});


    } catch (error) {

        console.error(
            "Erro status ML:",
            error
        );

        return res.status(500).json({

            connected: false,

            reason:
                "server_error"

        });

    }

});


// ============================================================
// 📊 RELATÓRIO DE PÓS-VENDA + 📦 ANÁLISE POR SKU
// ============================================================

app.get("/api/mercadolivre/pos-venda", async (req, res) => {

    try {

        const {
            chave,
            device_id,
            data_inicio,
            data_fim
        } = req.query;


        // ====================================================
        // VALIDAR DATAS
        // ====================================================

        if (!data_inicio || !data_fim) {

            return res.status(400).json({
                ok: false,
                reason: "missing_dates",
                message: "Informe data_inicio e data_fim."
            });

        }


        const inicio =
            new Date(`${data_inicio}T00:00:00.000Z`);

        const fim =
            new Date(`${data_fim}T23:59:59.999Z`);


        if (
            Number.isNaN(inicio.getTime()) ||
            Number.isNaN(fim.getTime())
        ) {

            return res.status(400).json({
                ok: false,
                reason: "invalid_dates",
                message: "Período inválido."
            });

        }


        if (inicio > fim) {

            return res.status(400).json({
                ok: false,
                reason: "invalid_period",
                message:
                    "A data inicial não pode ser maior que a data final."
            });

        }


        // ====================================================
        // VALIDAR ACESSO
        // ====================================================

        const {
            company
        } = await validarAcessoMercadoLivre(
            chave,
            device_id
        );


        // ====================================================
        // TOKEN
        // ====================================================

        const accessToken =
            await getValidMercadoLivreToken(
                company.id
            );


        const headers = {
            Authorization:
                `Bearer ${accessToken}`
        };


        // ====================================================
        // CONTA DO MERCADO LIVRE
        // ====================================================

        const {
            data: contaML,
            error: contaError
        } = await supabase
            .from("mercadolivre_accounts")
            .select(`
                ml_user_id,
                nickname
            `)
            .eq("company_id", company.id)
            .maybeSingle();


        if (contaError) {

            console.error(
                "Erro ao consultar conta Mercado Livre:",
                contaError
            );

            return res.status(500).json({
                ok: false,
                reason: "database_error"
            });

        }


        if (!contaML) {

            return res.status(400).json({
                ok: false,
                reason: "mercadolivre_not_connected",
                message:
                    "Mercado Livre ainda não conectado."
            });

        }


        const sellerId =
            contaML.ml_user_id;


        // ====================================================
        // BUSCAR PEDIDOS
        // ====================================================

        const pedidos = [];

        let offset = 0;

        const limit = 50;

        let totalPedidos = null;

        const MAX_PEDIDOS = 5000;


        while (true) {

            const params =
                new URLSearchParams({

                    seller:
                        String(sellerId),

                    "order.date_created.from":
                        inicio.toISOString(),

                    "order.date_created.to":
                        fim.toISOString(),

                    sort:
                        "date_desc",

                    offset:
                        String(offset),

                    limit:
                        String(limit)

                });


            const response =
                await axios.get(
                    `https://api.mercadolibre.com/orders/search?${params.toString()}`,
                    {
                        headers
                    }
                );


            const dados =
                response.data || {};


            const resultados =
                Array.isArray(dados.results)
                    ? dados.results
                    : [];


            if (totalPedidos === null) {

                totalPedidos =
                    dados.paging?.total ??
                    resultados.length;

            }


            pedidos.push(
                ...resultados
            );


            if (
                resultados.length === 0 ||
                resultados.length < limit ||
                pedidos.length >= totalPedidos ||
                pedidos.length >= MAX_PEDIDOS
            ) {

                break;

            }


            offset += limit;

        }


        const pedidosProcessados =
            pedidos.slice(0, MAX_PEDIDOS);


        // ====================================================
        // FUNÇÃO PARA BUSCAR SHIPMENTS DA VENDA
        // ====================================================

        async function buscarShipmentsPedido(orderId) {

            try {

                const response =
                    await axios.get(
                        `https://api.mercadolibre.com/orders/${orderId}/shipments?list_all=true`,
                        {
                            headers: {
                                ...headers,
                                "X-New-Domain": "true"
                            }
                        }
                    );


                const data =
                    response.data;


                if (Array.isArray(data)) {
                    return data;
                }


                if (data && typeof data === "object") {
                    return [data];
                }


                return [];

            } catch (error) {

                console.warn(
                    `Não foi possível consultar shipments da venda ${orderId}:`,
                    error.response?.data ||
                    error.message
                );

                return [];

            }

        }


        // ====================================================
        // BUSCAR SHIPMENTS
        // ====================================================

        /*
         * Não fazemos 475 requisições simultâneas.
         * Trabalhamos em blocos para evitar excesso de requisições.
         */

       const CONCORRENCIA = 4;

for (
    let i = 0;
    i < pedidos.length;
    i += CONCORRENCIA
) {

    const bloco =
        pedidos.slice(
            i,
            i + CONCORRENCIA
        );

    await Promise.all(
        bloco.map(
            async (pedido) => {

                pedido._shipments =
                    await buscarShipmentsPedido(
                        pedido.id
                    );

            }
        )
    );
}


        // ====================================================
        // CONTADORES
        // ====================================================

        let totalVendido = 0;

        let entregues = 0;

        let emTransporte = 0;
let quantidadeItensEmTransporte = 0;
        let cancelados = 0;

        let pagos = 0;

        let parcialmenteReembolsados = 0;

        let pedidosComProblema = 0;

        let quantidadeItens = 0;


        // ====================================================
        // LISTAS PARA CLIQUE NOS CARDS
        // ====================================================

        const vendasPorStatus = {

            pedidos: [],

            entregues: [],

            em_transporte: [],

            cancelados: [],

            reembolsados: [],

            problemas: []

        };


        // ====================================================
        // ANÁLISE POR SKU
        // ====================================================

        const skuMap =
            new Map();


        // ====================================================
        // PROCESSAR PEDIDOS
        // ====================================================

        for (
            const pedido of pedidosProcessados
        ) {

            const orderId =
                String(
                    pedido.id
                );


            const status =
                String(
                    pedido.status || ""
                ).toLowerCase();


            const tags =
                Array.isArray(pedido.tags)
                    ? pedido.tags
                    : [];


            const totalPedido =
                Number(
                    pedido.total_amount || 0
                );


            totalVendido +=
                totalPedido;


            // =================================================
            // OBJETO BASE DA VENDA
            // =================================================

            const venda = {

                id:
                    orderId,

                numero:
                    orderId,

                valor:
                    totalPedido,

                status:
                    status,

                data:
                    pedido.date_created || null,

                titulo:
                    pedido.order_items?.[0]?.item?.title ||
                    "Venda Mercado Livre"

            };


            vendasPorStatus.pedidos.push(
                venda
            );


            // =================================================
            // PAGAMENTO
            // =================================================

            if (status === "paid") {

                pagos++;

            }


            // =================================================
            // CANCELAMENTO
            // =================================================

            const pedidoCancelado =
                [
                    "cancelled",
                    "canceled",
                    "pending_cancel"
                ].includes(status);



            // =================================================
            // REEMBOLSO
            // =================================================

            let reembolsado =
                status === "partially_refunded";


            const pagamentos =
                Array.isArray(pedido.payments)
                    ? pedido.payments
                    : [];


            if (
                pagamentos.some(
                    pagamento =>
                        String(
                            pagamento.status || ""
                        ).toLowerCase() === "refunded"
                )
            ) {

                reembolsado = true;

            }


            // =================================================
            // SHIPMENTS
            // =================================================

            const shipments =
                Array.isArray(
                    pedido._shipments
                )
                    ? pedido._shipments
                    : [];


            /*
             * Consideramos somente shipment do tipo
             * forward como envio da venda.
             *
             * return = devolução ao vendedor.
             */

            const shipmentsForward =
                shipments.filter(
                    shipment =>
                        !shipment.type ||
                        shipment.type === "forward"
                );


            /*
             * Se houver mais de um shipment forward,
             * usamos o estado mais avançado.
             */

            const prioridadeStatus = {

                delivered: 6,

                shipped: 5,

                ready_to_ship: 4,

                handling: 3,

                pending: 2,

                not_verified: 1,

                not_delivered: 1,

                cancelled: 0

            };


            let shipmentPrincipal =
                null;


            for (
                const shipment of shipmentsForward
            ) {

                if (!shipmentPrincipal) {

                    shipmentPrincipal =
                        shipment;

                    continue;

                }


                const atual =
                    prioridadeStatus[
                        String(
                            shipment.status || ""
                        ).toLowerCase()
                    ] || 0;


                const anterior =
                    prioridadeStatus[
                        String(
                            shipmentPrincipal.status || ""
                        ).toLowerCase()
                    ] || 0;


                if (atual > anterior) {

                    shipmentPrincipal =
                        shipment;

                }

            }


            const shippingStatus =
                String(
                    shipmentPrincipal?.status || ""
                ).toLowerCase();


            // =================================================
            // PROBLEMAS
            // =================================================

            const problemaLogistico =
                [
                    "not_delivered",
                    "not_verified"
                ].includes(
                    shippingStatus
                );


            const problemaTag =
                tags.some(
                    tag =>
                        [
                            "not_delivered",
                            "fraud_risk_detected",
                            "delivered_not_confirmed",
                            "return",
                            "claim"
                        ].includes(
                            String(tag).toLowerCase()
                        )
                );



            // =================================================
            // ITENS DO PEDIDO
            // =================================================

            // =================================================
// CLASSIFICAÇÃO DO PEDIDO
// Cada pedido entra em apenas UMA categoria
// =================================================


let categoria = "outros";


if (pedidoCancelado) {

    categoria = "cancelados";

} else if (reembolsado) {

    categoria = "reembolsados";

} else if (
    problemaLogistico ||
    problemaTag
) {

    categoria = "problemas";

} else if (
    shippingStatus === "delivered"
) {

    categoria = "entregues";

} else if (
    ["pending","handling","ready_to_ship","shipped"].includes(shippingStatus)
) {
    categoria = "em_transporte";

    quantidadeItensEmTransporte += pedido.order_items.reduce(
    (total, item) => total + Number(item.quantity || 0),
        0
    );
}


// =================================================
// CONTADORES E LISTAS
// =================================================

switch (categoria) {

    case "cancelados":

        cancelados++;

        vendasPorStatus.cancelados.push(
            venda
        );

        break;


    case "reembolsados":

        parcialmenteReembolsados++;

        vendasPorStatus.reembolsados.push(
            venda
        );

        break;


    case "problemas":

        pedidosComProblema++;

        vendasPorStatus.problemas.push({

            ...venda,

            shipment_id:
                shipmentPrincipal?.id || null,

            shipment_status:
                shippingStatus,

            motivo:
                problemaLogistico
                    ? shippingStatus
                    : "pós-venda / reclamação"

        });

        break;


    case "entregues":

        entregues++;

        vendasPorStatus.entregues.push({

            ...venda,

            shipment_id:
                shipmentPrincipal?.id || null,

            shipment_status:
                shippingStatus

        });

        break;


    case "em_transporte":

        emTransporte++;

        vendasPorStatus.em_transporte.push({

            ...venda,

            shipment_id:
                shipmentPrincipal?.id || null,

            shipment_status:
                shippingStatus

        });

        break;

}

            const itens =
                Array.isArray(
                    pedido.order_items
                )
                    ? pedido.order_items
                    : [];


            for (
                const itemPedido of itens
            ) {

                const item =
                    itemPedido.item || {};


                const sku =
                    item.seller_custom_field ||
                    item.seller_sku ||
                    item.id ||
                    "SEM_SKU";


                const titulo =
                    item.title ||
                    "Produto sem título";


                const quantidade =
                    Number(
                        itemPedido.quantity || 0
                    );


                const precoUnitario =
                    Number(
                        itemPedido.unit_price || 0
                    );


                const valor =
                    quantidade *
                    precoUnitario;


                quantidadeItens +=
                    quantidade;


                if (!skuMap.has(sku)) {

                    skuMap.set(
                        sku,
                        {

                            sku,

                            titulo,

                            vendas: 0,

                            quantidade: 0,

                            valor_vendido: 0,

                            pedidos: 0,

                            cancelamentos: 0,

                            reembolsos: 0

                        }
                    );

                }


                const skuData =
                    skuMap.get(sku);


                skuData.vendas += 1;


                skuData.quantidade +=
                    quantidade;


                skuData.valor_vendido +=
                    valor;


                skuData.pedidos += 1;


                if (pedidoCancelado) {

                    skuData.cancelamentos++;

                }


                if (reembolsado) {

                    skuData.reembolsos++;

                }

            }

        }


        // ====================================================
        // CONVERTER MAP DE SKU
        // ====================================================

        const skus =
            Array.from(
                skuMap.values()
            )
            .map(item => {

                const ocorrencias =
    Math.max(
        item.cancelamentos,
        item.reembolsos
    );


                const taxa =
                    item.quantidade > 0
                        ? (
                            ocorrencias /
                            item.quantidade
                        ) * 100
                        : 0;


                return {

                    ...item,

                    ocorrencias,

                    taxa_problemas:
                        Number(
                            taxa.toFixed(2)
                        ),

                    valor_vendido:
                        Number(
                            item.valor_vendido.toFixed(2)
                        )

                };

            })
            .sort(
    (a, b) => {

        // Primeiro: maior % de ocorrência
        if (
            b.taxa_problemas !==
            a.taxa_problemas
        ) {

            return (
                b.taxa_problemas -
                a.taxa_problemas
            );

        }

        // Empate: maior quantidade de ocorrências
        if (
            b.ocorrencias !==
            a.ocorrencias
        ) {

            return (
                b.ocorrencias -
                a.ocorrencias
            );

        }

        // Segundo empate: maior quantidade vendida
        return (
            b.quantidade -
            a.quantidade
        );

    }
);


        // ====================================================
        // PERCENTUAIS
        // ====================================================

        const total =
            pedidosProcessados.length;


        const percentual =
            (valor) => {

                if (!total) {

                    return 0;

                }


                return Number(

                    (
                        (valor / total) *
                        100

                    ).toFixed(2)

                );

            };


        // ====================================================
        // REMOVER DUPLICADOS DAS LISTAS
        // ====================================================

        for (
            const chaveLista of
            Object.keys(vendasPorStatus)
        ) {

            const mapa =
                new Map();


            for (
                const venda of
                vendasPorStatus[chaveLista]
            ) {

                mapa.set(
                    venda.id,
                    venda
                );

            }


            vendasPorStatus[chaveLista] =
                Array.from(
                    mapa.values()
                );

        }


        // ====================================================
        // RESPOSTA
        // ====================================================

        return res.json({

            ok: true,

            periodo: {

                inicio:
                    data_inicio,

                fim:
                    data_fim

            },

            vendedor: {

                id:
                    sellerId,

                nickname:
                    contaML.nickname || null

            },

            resumo: {

                pedidos:
                    total,

                pedidos_total_api:
                    totalPedidos,

                pedidos_processados:
                    pedidosProcessados.length,

                total_vendido:
                    Number(
                        totalVendido.toFixed(2)
                    ),

                quantidade_itens:
                    quantidadeItens,

                entregues,

                em_transporte:
                    emTransporte,
quantidade_itens_em_transporte: quantidadeItensEmTransporte,
                pagos,

                cancelados,

                parcialmente_reembolsados:
                    parcialmenteReembolsados,

                pedidos_com_problema:
                    pedidosComProblema,

                percentual_cancelamentos:
                    percentual(cancelados),

                percentual_problemas:
                    percentual(pedidosComProblema)

            },

            // =================================================
            // LISTAS PARA OS CARDS
            // =================================================

            vendas_por_status:
                vendasPorStatus,

            skus,

            pedidos:
                pedidosProcessados

        });

    } catch (error) {

        console.error(
            "Erro no relatório de pós-venda:",
            error.response?.data ||
            error.message ||
            error
        );


        return res.status(
            error.response?.status || 500
        ).json({

            ok: false,

            reason:
                "pos_venda_error",

            message:
                error.response?.data?.message ||
                error.message ||
                "Erro ao gerar relatório de pós-venda."

        });

    }

});


// ============================================================
// 🔔 MONITOR DE VENDAS E CANCELAMENTOS
// ============================================================
//
// Consulta:
// - pedidos criados recentemente
// - pedidos alterados nas últimas 2 horas
// - cancelamentos explicitamente
//
// A extensão fará a consulta a cada 1 minuto.
// ============================================================

// ============================================================
// 🔔 MONITOR AUTOMÁTICO DE VENDAS E CANCELAMENTOS
// ============================================================

app.get(
    "/api/mercadolivre/monitor-vendas",
    async (req, res) => {

        try {
                const {
                chave,
                device_id
            } = req.query;


            // ====================================================
            // VALIDAR ACESSO
            // ====================================================

            if (!chave || !device_id) {

                return res.status(400).json({
                    ok: false,
                    reason: "missing_credentials",
                    message:
                        "chave e device_id são obrigatórios."
                });

            }


            const {
                company
            } = await validarAcessoMercadoLivre(
                chave,
                device_id
            );


            // ====================================================
            // TOKEN
            // ====================================================

            const accessToken =
                await getValidMercadoLivreToken(
                    company.id
                );


            const headers = {
                Authorization:
                    `Bearer ${accessToken}`
            };


            // ====================================================
            // CONTA MERCADO LIVRE
            // ====================================================

            const {
                data: contaML,
                error: contaError
            } = await supabase
                .from("mercadolivre_accounts")
                .select(`
                    ml_user_id,
                    nickname
                `)
                .eq(
                    "company_id",
                    company.id
                )
                .maybeSingle();


            if (contaError) {

                console.error(
                    "Erro ao consultar conta ML:",
                    contaError
                );

                return res.status(500).json({
                    ok: false,
                    reason: "database_error"
                });

            }


            if (!contaML) {

                return res.status(400).json({
                    ok: false,
                    reason:
                        "mercadolivre_not_connected",
                    message:
                        "Mercado Livre ainda não conectado."
                });

            }


            const sellerId =
                contaML.ml_user_id;


            // ====================================================
            // DATA DE HOJE
            // ====================================================

            const agora =
                new Date();

            const inicioDoDia =
                new Date(agora);

            inicioDoDia.setHours(
                0,
                0,
                0,
                0
            );


            // ====================================================
            // FUNÇÃO PARA BUSCAR PEDIDOS
            // ====================================================

            async function buscarPedidos(
                paramsExtras
            ) {

                const params =
                    new URLSearchParams({

                        seller:
                            String(sellerId),

                        sort:
                            "date_desc",

                        offset:
                            "0",

                        limit:
                            "50",

                        ...paramsExtras

                    });


                const response =
                    await axios.get(
                        `https://api.mercadolibre.com/orders/search?${params.toString()}`,
                        {
                            headers
                        }
                    );


                return Array.isArray(
                    response.data?.results
                )
                    ? response.data.results
                    : [];

            }


            // ====================================================
            // 1️⃣ PEDIDOS ALTERADOS HOJE
            // ====================================================

            const pedidosAlterados =
                await buscarPedidos({

                    "order.date_last_updated.from":
                        inicioDoDia.toISOString(),

                    "order.date_last_updated.to":
                        agora.toISOString()

                });


            // ====================================================
            // 2️⃣ PEDIDOS CRIADOS HOJE
            // ====================================================

            const pedidosNovos =
                await buscarPedidos({

                    "order.date_created.from":
                        inicioDoDia.toISOString(),

                    "order.date_created.to":
                        agora.toISOString()

                });
    

            // ====================================================
            // 3️⃣ CANCELAMENTOS DE HOJE
            // ====================================================

            const pedidosCancelados =
                await buscarPedidos({

                    "order.date_last_updated.from":
                        inicioDoDia.toISOString(),

                    "order.date_last_updated.to":
                        agora.toISOString(),

                    "order.status":
                        "cancelled"

                });


            // ====================================================
            // JUNTAR PEDIDOS
            // ====================================================

            const mapaPedidos =
                new Map();


            [
                ...pedidosAlterados,
                ...pedidosNovos,
                ...pedidosCancelados
            ].forEach(pedido => {

                if (!pedido?.id) {
                    return;
                }

                mapaPedidos.set(
                    String(pedido.id),
                    pedido
                );

            });

            const pedidos =
                Array.from(
                    mapaPedidos.values()
                               );  

            // ====================================================
            // BUSCAR SHIPMENTS
            // ====================================================

            async function buscarShipmentsPedido(
                orderId
            ) {

                try {

                    const response =
                        await axios.get(
                            `https://api.mercadolibre.com/orders/${orderId}/shipments?list_all=true`,
                            {
                                headers: {
                                    ...headers,
                                    "X-New-Domain": "true"
                                }
                            }
                        );


                    const data =
                        response.data;


                    if (Array.isArray(data)) {
                        return data;
                    }


                    if (
                        data &&
                        typeof data === "object"
                    ) {

                        return [data];

                    }


                    return [];

                } catch (error) {

    const status = error.response?.status;

    // 404 = essa venda não possui shipment
    // É esperado em alguns pedidos, então não poluir o log.
    if (status === 404) {
    return [];
}
    console.warn(
        `Não foi possível consultar shipments da venda ${orderId}:`,
        error.response?.data ||
        error.message
    );

    return [];

}

            }


// ====================================================
// CONSULTAR SHIPMENTS
// ====================================================

const CONCORRENCIA = 3;

for (
    let i = 0;
    i < pedidos.length;
    i += CONCORRENCIA
) {

    const bloco =
        pedidos.slice(
            i,
            i + CONCORRENCIA
        );

    await Promise.all(
        bloco.map(
            async (pedido) => {

                pedido._shipments =
                    await buscarShipmentsPedido(
                        pedido.id
                    );

            }
        )
    );

}

            // ====================================================
            // NORMALIZAR E FILTRAR
            // ====================================================

            const resultado =
                pedidos
                    .map(pedido => {

                        const status =
                            String(
                                pedido.status || ""
                            )
                                .trim()
                                .toLowerCase();


                        const tags =
                            Array.isArray(
                                pedido.tags
                            )
                                ? pedido.tags
                                : [];


                        const itens =
                            Array.isArray(
                                pedido.order_items
                            )
                                ? pedido.order_items
                                : [];


                        const produtos =
                            itens.map(item => {

                                const itemData =
                                    item.item || {};


                                return {

                                    id:
                                        itemData.id ||
                                        null,

                                    title:
                                        itemData.title ||
                                        "Produto",

                                    seller_sku:
                                        itemData.seller_sku ||
                                        itemData.seller_custom_field ||
                                        null,

                                    quantity:
                                        Number(
                                            item.quantity || 0
                                        ),

                                    unit_price:
                                        Number(
                                            item.unit_price || 0
                                        )

                                };

                            });


                        const quantidade =
                            produtos.reduce(
                                (
                                    total,
                                    produto
                                ) =>
                                    total +
                                    produto.quantity,
                                0
                            );

// ========================================
                        // SHIPMENTS
                        // ========================================

                        const shipments =
                            Array.isArray(
                                pedido._shipments
                            )
                                ? pedido._shipments
                                : [];


                        /*
                         * Somente shipment de envio.
                         *
                         * Shipment "return" é devolução
                         * e não deve gerar notificação.
                         */

                        const shipmentsForward =
                            shipments.filter(
                                shipment =>
                                    !shipment.type ||
                                    shipment.type === "forward"
                            );


                        /*
                         * ETIQUETA PRONTA
                         *
                         * É exatamente:
                         *
                         * status:
                         * ready_to_ship
                         *
                         * substatus:
                         * ready_to_print
                         */

                        const shipmentEtiqueta =
                            shipmentsForward.find(
                                shipment =>
                                    String(
                                        shipment.status || ""
                                    ).toLowerCase() ===
                                        "ready_to_ship"
                                    &&
                                    String(
                                        shipment.substatus || ""
                                    ).toLowerCase() ===
                                        "ready_to_print"
                            );


                        const etiquetaPronta =
                            !!shipmentEtiqueta;


                     // ========================================
// CANCELAMENTO
// ========================================

const tagsDevolucao = [
    "return",
    "returned",
    "returning",
    "refund",
    "refunded"
];

const temDevolucao =
    shipments.some(
        shipment =>
            String(
                shipment.type || ""
            ).toLowerCase() === "return"
    ) ||
    tags.some(tag =>
        tagsDevolucao.includes(
            String(tag).toLowerCase()
        )
    );

const cancelado =
    (
        status === "cancelled" ||
        status === "canceled"
    ) &&
    !temDevolucao;

                        
                        // ========================================
                        // FILTRO FINAL
                        // ========================================

                       if (cancelado) {
    return pedido;
}


                       return {
    id:
        String(pedido.id),

    pack_id:
        pedido.pack_id
            ? String(pedido.pack_id)
            : null,

    status,

                            cancelado,

                            etiqueta_pronta:
                                etiquetaPronta,

                            shipment_status:
                                shipmentEtiqueta?.status ||
                                null,

                            shipment_substatus:
                                shipmentEtiqueta?.substatus ||
                                null,

                            tags,

                            date_created:
                                pedido.date_created ||
                                null,

                            date_last_updated:
                                pedido.date_last_updated ||
                                null,

                            total_amount:
                                Number(
                                    pedido.total_amount || 0
                                ),

                            currency_id:
                                pedido.currency_id ||
                                "BRL",

                            quantidade,

                            produtos

                        };

                    })
                    .filter(Boolean);


            // ====================================================
            // RESPOSTA
            // ====================================================

            return res.json({

                ok: true,

                server_time:
                    agora.toISOString(),

                vendedor: {

                    id:
                        sellerId,

                    nickname:
                        contaML.nickname ||
                        null

                },

                pedidos:
                    resultado,

                total_pedidos:
                    resultado.length,

                total_cancelados:
                    resultado.filter(
                        pedido =>
                            pedido.cancelado
                    ).length,

                total_etiquetas_prontas:
                    resultado.filter(
                        pedido =>
                            pedido.etiqueta_pronta
                    ).length

            });


        } catch (error) {

            console.error(
                "❌ Erro no monitor de vendas ML:",
                error.response?.data ||
                error.message ||
                error
            );


            if (error.statusCode) {

                return res.status(
                    error.statusCode
                ).json({

                    ok: false,

                    reason:
                        error.reason,

                    message:
                        error.message

                });

            }


            if (error.response) {

                return res.status(
                    error.response.status || 500
                ).json({

                    ok: false,

                    reason:
                        "mercadolivre_api_error",

                    message:
                        error.response.data?.message ||
                        "Erro ao consultar Mercado Livre",

                    details:
                        error.response.data ||
                        null

                });

            }


            return res.status(500).json({

                ok: false,

                reason:
                    "monitor_error",

                message:
                    error.message ||
                    "Erro interno no monitor de vendas."

            });

        }

    }
);
// ============================================================
// 🔄 CLONAR ANÚNCIO MERCADO LIVRE
// ============================================================
//
// POST /api/mercadolivre/clonar-anuncio
//
// Recebe:
// {
//     chave,
//     device_id,
//     link,
//     confirmar
// }
//
// - confirmar:false → somente consulta o anúncio
// - confirmar:true  → cria o anúncio na conta conectada
// - estoque inicial = 0
// ============================================================

app.post(
    "/api/mercadolivre/clonar-anuncio",
    async (req, res) => {

        try {

            const {
                chave,
                device_id,
                link,
                confirmar
            } = req.body;


            // ====================================================
            // VALIDAR DADOS
            // ====================================================

            if (!chave || !device_id) {

                return res.status(400).json({
                    ok: false,
                    reason: "missing_credentials",
                    message:
                        "chave e device_id são obrigatórios."
                });

            }


            if (!link) {

                return res.status(400).json({
                    ok: false,
                    reason: "missing_link",
                    message:
                        "Informe o link ou código MLB do anúncio."
                });

            }


            // ====================================================
            // EXTRAIR MLB
            // ====================================================

            let itemId =
                String(link)
                    .trim()
                    .toUpperCase();


            /*
             * Aceita:
             *
             * MLB123456789
             * MLB-123456789
             * MLB_123456789
             * MLBU123456789
             * MLBU-123456789
             *
             * URLs:
             *
             * https://produto.mercadolivre.com.br/MLB-123456789
             * https://www.mercadolivre.com.br/...
             */

            const match =
                itemId.match(
                    /MLB(?:U)?[-_]?(\d+)/i
                );


            if (match) {

                itemId =
                    `MLB${match[1]}`;

            }


            if (!/^MLB\d+$/i.test(itemId)) {

                return res.status(400).json({
                    ok: false,
                    reason: "invalid_item_id",
                    message:
                        "Não foi possível identificar um código MLB válido."
                });

            }


            itemId =
                itemId.toUpperCase();


            console.log(
                `🔄 Iniciando clonagem do anúncio ${itemId}`
            );


            // ====================================================
            // VALIDAR LICENÇA / EMPRESA
            // ====================================================

            const {
                company
            } =
                await validarAcessoMercadoLivre(
                    chave,
                    device_id
                );


            // ====================================================
            // TOKEN DA CONTA CONECTADA
            // ====================================================

            const accessToken =
                await getValidMercadoLivreToken(
                    company.id
                );


            /*
             * Este token é usado somente para operações
             * na conta conectada.
             */

            const headers = {

                Authorization:
                    `Bearer ${accessToken}`,

                Accept:
                    "application/json"

            };


// ====================================================
// TESTAR TOKEN
// ====================================================

console.log("🔐 TESTANDO TOKEN ML...");

try {

    const meResponse =
        await axios.get(
            "https://api.mercadolibre.com/users/me",
            {
                headers
            }
        );

    console.log(
        "✅ TOKEN OK:",
        JSON.stringify(
            {
                id:
                    meResponse.data?.id,

                nickname:
                    meResponse.data?.nickname
            },
            null,
            2
        )
    );

} catch (tokenError) {

    console.error(
        "❌ TOKEN NÃO TEM ACESSO:",
        JSON.stringify(
            tokenError.response?.data ||
            tokenError.message,
            null,
            2
        )
    );

    return res.status(
        tokenError.response?.status || 500
    ).json({

        ok: false,

        reason:
            "token_test_error",

        message:
            tokenError.response?.data?.message ||
            tokenError.message,

        details:
            tokenError.response?.data ||
            null

    });

}

            // ====================================================
            // BUSCAR ANÚNCIO DE ORIGEM
            // ====================================================
            //
            // IMPORTANTE:
            // Não usamos o token da conta conectada para buscar
            // o anúncio público de origem.
            //
            // Isso permite clonar anúncios públicos de outros
            // vendedores.
            // ====================================================

            let itemResponse;

            try {

                console.log("🔐 Buscando anúncio de origem com token da conta conectada...");

itemResponse =
    await axios.get(
        `https://api.mercadolibre.com/items/${itemId}?include_attributes=all`,
        { headers }
    );

    const item = itemResponse.data;

console.log(
    "✅ Anúncio de origem encontrado:",
    item.id,
    "|",
    item.title
);

// ==========================================
// ATRIBUTOS DO ANÚNCIO
// ==========================================

const attributes =
    Array.isArray(item.attributes)
        ? item.attributes
            .filter(
                attribute =>
                    attribute &&
                    attribute.id &&
                    (
                        attribute.value_id ||
                        attribute.value_name
                    )
            )
            .map(attribute => {
                const resultado = {
                    id: attribute.id
                };

                if (attribute.value_id) {
                    resultado.value_id = attribute.value_id;
                }

                if (attribute.value_name) {
                    resultado.value_name = attribute.value_name;
                }

                return resultado;
            })
        : [];

console.log(
    "🏷️ Atributos encontrados:",
    attributes.length
);

            } catch (itemError) {

                console.error(
                    "❌ Erro ao buscar anúncio de origem:",
                    itemError.response?.data ||
                    itemError.message
                );


                return res.status(
                    itemError.response?.status || 404
                ).json({

                    ok: false,

                    reason:
                        "source_item_error",

                    message:
                        itemError.response?.data?.message ||
                        `Não foi possível encontrar o anúncio ${itemId}.`,

                    details:
                        itemError.response?.data ||
                        null

                });

            }


            const item =
                itemResponse.data;


            if (!item) {

                return res.status(404).json({

                    ok: false,

                    reason:
                        "item_not_found",

                    message:
                        "Anúncio não encontrado."

                });

            }


            // ====================================================
            // VALIDAR STATUS
            // ====================================================

            if (
                item.status === "deleted" ||
                item.status === "under_review"
            ) {

                return res.status(400).json({

                    ok: false,

                    reason:
                        "item_unavailable",

                    message:
                        "Este anúncio não está disponível para clonagem."

                });

            }


            // ====================================================
            // CATÁLOGO
            // ====================================================

            if (
                item.catalog_listing === true
            ) {

                return res.status(400).json({

                    ok: false,

                    reason:
                        "catalog_listing",

                    message:
                        "Este anúncio pertence ao catálogo do Mercado Livre e não pode ser clonado desta forma."

                });

            }


            console.log(
                `✅ Anúncio de origem encontrado: ${item.id} | ${item.title}`
            );


            // ====================================================
            // DESCRIÇÃO
            // ====================================================

            let descricao = "";

try {

    console.log("📝 Buscando descrição do anúncio...");

    // Primeiro tenta pela API autenticada
    try {

        const descriptionResponse =
            await axios.get(
                `https://api.mercadolibre.com/items/${itemId}/description`,
                {
                    headers: {
                        ...headers,
                        Accept: "application/json"
                    }
                }
            );

        descricao =
            descriptionResponse.data?.plain_text ||
            descriptionResponse.data?.text ||
            "";

        console.log(
            "✅ Descrição obtida pela API:",
            descricao.length,
            "caracteres"
        );

    } catch (apiDescriptionError) {

        console.warn(
            "⚠️ API não retornou a descrição:",
            apiDescriptionError.response?.data ||
            apiDescriptionError.message
        );

        // Aqui entraremos no fallback da página pública
    }

} catch (descriptionError) {

    console.warn(
        "⚠️ Não foi possível obter descrição:",
        descriptionError.response?.data ||
        descriptionError.message
    );

}

            // ====================================================
            // PREVIEW
            // ====================================================

            if (!confirmar) {

                return res.json({

                    ok: true,

                    modo:
                        "preview",

                    anuncio: {

                        id:
                            item.id,

                        title:
                            item.title,

                        category_id:
                            item.category_id,

                        price:
                            item.price,

                        currency_id:
                            item.currency_id,

                        condition:
                            item.condition,

                        listing_type_id:
                            item.listing_type_id,

                        buying_mode:
                            item.buying_mode,

                        status:
                            item.status,

                        seller_id:
                            item.seller_id,

                        permalink:
                            item.permalink,

                        images_count:
                            Array.isArray(
                                item.pictures
                            )
                                ? item.pictures.length
                                : 0,

                        variations_count:
                            Array.isArray(
                                item.variations
                            )
                                ? item.variations.length
                                : 0,

                        catalog_listing:
                            !!item.catalog_listing,

                        descricao:
                            !!descricao

                    }

                });

            }


            // ====================================================
            // TIPO DE ANÚNCIO
            // ====================================================
            //
            // NÃO copiar o listing_type_id da conta de origem.
            //
            // A conta conectada pode não possuir autorização
            // para o mesmo tipo de anúncio.
            //
            // gold_special é o tipo padrão usado no MLB.
            // ====================================================

            let listingTypeId =
                "gold_special";


            try {

                const listingTypesResponse =
                    await axios.get(
                        "https://api.mercadolibre.com/sites/MLB/listing_types",
                        {
                            headers
                        }
                    );


                const listingTypes =
                    Array.isArray(
                        listingTypesResponse.data
                    )
                        ? listingTypesResponse.data
                        : [];


                const goldSpecial =
                    listingTypes.find(
                        type =>
                            type.id ===
                            "gold_special"
                    );


                if (goldSpecial) {

                    listingTypeId =
                        goldSpecial.id;

                }

            } catch (listingTypeError) {

                console.warn(
                    "⚠️ Não foi possível consultar tipos de anúncio. Usando gold_special:",
                    listingTypeError.response?.data ||
                    listingTypeError.message
                );

            }


            // ====================================================
            // FOTOS
            // ====================================================

            const pictures =
                Array.isArray(item.pictures)

                    ? item.pictures
                        .filter(
                            picture =>
                                picture &&
                                (
                                    picture.source ||
                                    picture.url
                                )
                        )
                        .map(
                            picture => ({
                                source:
                                    picture.source ||
                                    picture.url
                            })
                        )

                    : [];

                // ====================================================
// ATRIBUTOS DO ANÚNCIO + ATRIBUTOS OBRIGATÓRIOS
// ====================================================

// Mantém somente atributos que podem ser enviados.
// ITEM_CONDITION fica de fora porque o anúncio será criado
// explicitamente com condition: "not_specified".

const attributes = [];

const atributosOriginais =
    Array.isArray(item.attributes)
        ? item.attributes
        : [];

// ----------------------------------------------------
// COPIAR ATRIBUTOS ORIGINAIS
// ----------------------------------------------------

for (const attribute of atributosOriginais) {

    if (
        !attribute ||
        !attribute.id
    ) {
        continue;
    }

    const id =
        String(attribute.id).toUpperCase();

    // Não enviar ITEM_CONDITION junto com condition
    if (
        id === "ITEM_CONDITION"
    ) {
        continue;
    }

    if (
        !attribute.value_id &&
        !attribute.value_name
    ) {
        continue;
    }

    const novoAtributo = {
        id: attribute.id
    };

    if (attribute.value_id) {
        novoAtributo.value_id =
            attribute.value_id;
    }

    if (attribute.value_name) {
        novoAtributo.value_name =
            attribute.value_name;
    }

    attributes.push(
        novoAtributo
    );
}

console.log(
    "🏷️ Atributos copiados do anúncio:",
    attributes.length
);


// ====================================================
// BUSCAR ATRIBUTOS OBRIGATÓRIOS DA CATEGORIA
// ====================================================

let atributosObrigatorios = [];

let atributosObrigatoriosFaltando = [];

try {

    const categoryAttributesResponse =
        await axios.get(
            `https://api.mercadolibre.com/categories/${item.category_id}/attributes`,
            {
                headers
            }
        );

    const categoryAttributes =
        Array.isArray(
            categoryAttributesResponse.data
        )
            ? categoryAttributesResponse.data
            : [];


    atributosObrigatorios =
        categoryAttributes
            .filter(attribute => {

                if (
                    !attribute ||
                    !attribute.id
                ) {
                    return false;
                }

                // ITEM_CONDITION já é tratado pelo campo condition
                if (
                    String(attribute.id).toUpperCase() ===
                    "ITEM_CONDITION"
                ) {
                    return false;
                }

                return (
                    attribute.tags?.required === true ||
                    attribute.required === true
                );

            })
            .map(attribute => ({
                id: attribute.id,
                name: attribute.name,
                value_type:
                    attribute.value_type || null
            }));


    console.log(
        "📋 Atributos obrigatórios da categoria:",
        JSON.stringify(
            atributosObrigatorios,
            null,
            2
        )
    );

} catch (attributeError) {

    console.warn(
        "⚠️ Não foi possível consultar atributos da categoria:",
        attributeError.response?.data ||
        attributeError.message
    );

}


// ====================================================
// FUNÇÕES AUXILIARES
// ====================================================

function normalizarTexto(valor) {

    return String(
        valor || ""
    )
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

}


function encontrarAtributo(
    lista,
    ids
) {

    const idsNormalizados =
        ids.map(
            id =>
                normalizarTexto(id)
        );

    return lista.find(
        atributo =>
            idsNormalizados.includes(
                normalizarTexto(
                    atributo.id
                )
            )
    );

}


// ====================================================
// RECUPERAR AUTOMATICAMENTE OBRIGATÓRIOS
// ====================================================

for (
    const obrigatorio
    of atributosObrigatorios
) {

    const idObrigatorio =
        String(
            obrigatorio.id
        ).toUpperCase();


    // ------------------------------------------------
    // JÁ EXISTE
    // ------------------------------------------------

    const jaExiste =
        attributes.some(
            atributo =>
                String(
                    atributo.id
                ).toUpperCase() ===
                idObrigatorio
        );


    if (jaExiste) {

        console.log(
            `✅ Obrigatório já encontrado: ${idObrigatorio}`
        );

        continue;
    }


    // ------------------------------------------------
    // PROCURAR NOVAMENTE NO ORIGINAL
    // ------------------------------------------------

    const original =
        atributosOriginais.find(
            atributo =>
                atributo &&
                String(
                    atributo.id
                ).toUpperCase() ===
                idObrigatorio &&
                (
                    atributo.value_id ||
                    atributo.value_name
                )
        );


    if (original) {

        const novoAtributo = {
            id: original.id
        };

        if (original.value_id) {
            novoAtributo.value_id =
                original.value_id;
        }

        if (original.value_name) {
            novoAtributo.value_name =
                original.value_name;
        }

        attributes.push(
            novoAtributo
        );

        console.log(
            `✅ Obrigatório recuperado do original: ${idObrigatorio}`
        );

        continue;
    }


    // =================================================
    // MANUFACTURER
    // =================================================

    if (
        idObrigatorio ===
        "MANUFACTURER"
    ) {

        const brand =
            encontrarAtributo(
                atributosOriginais,
                [
                    "BRAND",
                    "MARCA"
                ]
            );


        if (
            brand &&
            (
                brand.value_id ||
                brand.value_name
            )
        ) {

            const novoAtributo = {
                id: "MANUFACTURER"
            };

            if (brand.value_id) {

                novoAtributo.value_id =
                    brand.value_id;

            }

            if (brand.value_name) {

                novoAtributo.value_name =
                    brand.value_name;

            }

            attributes.push(
                novoAtributo
            );

            console.log(
                "✅ MANUFACTURER recuperado através de BRAND:",
                brand.value_name
            );

            continue;
        }

    }


    // =================================================
    // ALPHANUMERIC_MODELS
    // =================================================

    if (
        idObrigatorio ===
        "ALPHANUMERIC_MODELS"
    ) {

        const possiveisModelos =
            [
                "MODEL",
                "MODEL_NUMBER",
                "MODEL_NAME",
                "MODEL_ALPHANUMERIC",
                "MPN",
                "PART_NUMBER"
            ];


        const modelo =
            encontrarAtributo(
                atributosOriginais,
                possiveisModelos
            );


        if (
            modelo &&
            (
                modelo.value_id ||
                modelo.value_name
            )
        ) {

            const novoAtributo = {
                id: "ALPHANUMERIC_MODELS"
            };


            if (
                modelo.value_id
            ) {

                novoAtributo.value_id =
                    modelo.value_id;

            }


            if (
                modelo.value_name
            ) {

                novoAtributo.value_name =
                    modelo.value_name;

            }


            attributes.push(
                novoAtributo
            );


            console.log(
                "✅ ALPHANUMERIC_MODELS recuperado através do modelo:",
                modelo.value_name
            );

            continue;
        }

    }


   // =================================================
// COLOR
// =================================================

if (
    idObrigatorio ===
    "COLOR"
) {

    let corEncontrada = null;


    // -------------------------------------------------
    // 1. PROCURAR NOS ATRIBUTOS ORIGINAIS
    // -------------------------------------------------

    const corAtributo =
        encontrarAtributo(
            atributosOriginais,
            [
                "COLOR",
                "COLOUR",
                "COR",
                "COLOR_NAME",
                "COLOR_SECONDARY"
            ]
        );


    if (
        corAtributo &&
        (
            corAtributo.value_id ||
            corAtributo.value_name
        )
    ) {

        corEncontrada =
            corAtributo.value_name ||
            corAtributo.value_id;

    }


    // -------------------------------------------------
    // 2. PROCURAR NAS VARIAÇÕES
    // -------------------------------------------------

    if (
        !corEncontrada &&
        Array.isArray(item.variations)
    ) {

        for (
            const variation
            of item.variations
        ) {

            const combinacoes =
                Array.isArray(
                    variation.attribute_combinations
                )
                    ? variation.attribute_combinations
                    : [];


            const corVariacao =
                encontrarAtributo(
                    combinacoes,
                    [
                        "COLOR",
                        "COLOUR",
                        "COR",
                        "COLOR_NAME"
                    ]
                );


            if (
                corVariacao &&
                (
                    corVariacao.value_name ||
                    corVariacao.value_id
                )
            ) {

                corEncontrada =
                    corVariacao.value_name ||
                    corVariacao.value_id;

                break;

            }

        }

    }


    // -------------------------------------------------
    // 3. PROCURAR NO TÍTULO
    // -------------------------------------------------

    if (
        !corEncontrada &&
        item.title
    ) {

        const titulo =
            normalizarTexto(
                item.title
            );


        const coresConhecidas = [
            "preto",
            "preta",
            "branco",
            "branca",
            "azul",
            "vermelho",
            "vermelha",
            "verde",
            "amarelo",
            "amarela",
            "rosa",
            "roxo",
            "roxa",
            "lilas",
            "cinza",
            "prata",
            "dourado",
            "dourada",
            "grafite",
            "marrom",
            "bege",
            "laranja",
            "violeta",
            "turquesa"
        ];


        const corTitulo =
            coresConhecidas.find(
                cor =>
                    titulo.includes(
                        ` ${cor} `
                    ) ||
                    titulo.startsWith(
                        `${cor} `
                    ) ||
                    titulo.endsWith(
                        ` ${cor}`
                    )
            );


        if (
            corTitulo
        ) {

            corEncontrada =
                corTitulo;

        }

    }


    // -------------------------------------------------
    // 4. SE ENCONTROU
    // -------------------------------------------------

    if (
        corEncontrada
    ) {

        attributes.push({

            id:
                "COLOR",

            value_name:
                corEncontrada

        });


        console.log(
            "✅ COLOR recuperado automaticamente:",
            corEncontrada
        );


        continue;

    }


    // -------------------------------------------------
    // 5. NÃO INVENTAR COR
    // -------------------------------------------------

    console.warn(
        "⚠️ COLOR não encontrado no anúncio original."
    );

}


    // =================================================
    // PROCURAR ATRIBUTO EQUIVALENTE PELO NOME
    // =================================================

    const nomeObrigatorio =
        normalizarTexto(
            obrigatorio.name
        );


    const equivalente =
        atributosOriginais.find(
            atributo => {

                if (
                    !atributo ||
                    !atributo.id
                ) {
                    return false;
                }


                if (
                    !atributo.value_id &&
                    !atributo.value_name
                ) {
                    return false;
                }


                const id =
                    normalizarTexto(
                        atributo.id
                    );


                const nome =
                    normalizarTexto(
                        atributo.name
                    );


                return (
                    id ===
                    nomeObrigatorio ||
                    nome ===
                    nomeObrigatorio
                );

            }
        );


    if (
        equivalente
    ) {

        const novoAtributo = {
            id:
                obrigatorio.id
        };


        if (
            equivalente.value_id
        ) {

            novoAtributo.value_id =
                equivalente.value_id;

        }


        if (
            equivalente.value_name
        ) {

            novoAtributo.value_name =
                equivalente.value_name;

        }


        attributes.push(
            novoAtributo
        );


        console.log(
            `✅ Obrigatório recuperado por equivalência: ${idObrigatorio}`
        );

        continue;
    }


    // ------------------------------------------------
    // SE CHEGOU AQUI, NÃO FOI POSSÍVEL RECUPERAR
    // ------------------------------------------------

    console.warn(
        `⚠️ Não foi possível determinar automaticamente: ${idObrigatorio}`
    );

}


// ====================================================
// VERIFICAR O QUE REALMENTE CONTINUA FALTANDO
// ====================================================

const idsDosAtributos =
    new Set(
        attributes.map(
            attribute =>
                String(
                    attribute.id
                ).toUpperCase()
        )
    );


atributosObrigatoriosFaltando =
    atributosObrigatorios.filter(
        attribute =>
            !idsDosAtributos.has(
                String(
                    attribute.id
                ).toUpperCase()
            )
    );


console.log(
    "🏷️ Total de atributos finais:",
    attributes.length
);


console.log(
    "⚠️ Atributos obrigatórios ainda faltando:",
    JSON.stringify(
        atributosObrigatoriosFaltando,
        null,
        2
    )
);


// ====================================================
// OBJETO BASE DO NOVO ANÚNCIO
// ====================================================

console.log(
    "🔎 CAMPOS IMPORTANTES DO ANÚNCIO:",
    JSON.stringify(
        {
            id: item.id,
            title: item.title,
            family_name: item.family_name,
            familyName: item.familyName,
            category_id: item.category_id,
            seller_id: item.seller_id,
            listing_type_id:
                item.listing_type_id,
            attributes_count:
                attributes.length
        },
        null,
        2
    )
);


// ====================================================
// FAMILY NAME
// ====================================================

let familyName =
    item.family_name ||
    item.familyName ||
    null;

// Se o anúncio original não possuir family_name,
// usamos um nome baseado no produto.
// Isso é necessário para categorias que exigem
// family_name na criação.
if (!familyName) {

    const marca =
        attributes.find(
            attribute =>
                String(attribute.id).toUpperCase() === "BRAND"
        )?.value_name ||
        "";

    const modelo =
        attributes.find(
            attribute =>
                String(attribute.id).toUpperCase() === "MODEL"
        )?.value_name ||
        "";

    if (marca && modelo) {

        familyName =
            `${marca} ${modelo}`.trim();

    } else if (item.title) {

        familyName =
            String(item.title).trim();

    }

}

console.log(
    "👨‍👩‍👧 family_name final:",
    familyName
);


const novoItem = {

    category_id:
        item.category_id,

    price:
        Number(
            item.price || 0
        ),

    currency_id:
        item.currency_id ||
        "BRL",

    buying_mode:
        "buy_it_now",

    listing_type_id:
        "gold_special",

    condition:
        "not_specified",

    available_quantity:
        1,

    pictures:
        pictures,

    attributes:
        attributes

};


if (familyName) {

    novoItem.family_name =
        familyName;

}


// ====================================================
// NÃO DEIXAR O MERCADO LIVRE RECEBER VALOR INVENTADO
// ====================================================

if (
    atributosObrigatoriosFaltando.length > 0
) {

    console.warn(
        "❌ Ainda existem atributos obrigatórios que não podem ser determinados com segurança:",
        atributosObrigatoriosFaltando
    );


    return res.status(
        400
    ).json({

        ok:
            false,

        reason:
            "missing_required_attributes",

        message:
            "Não foi possível determinar automaticamente todos os atributos obrigatórios do anúncio original.",

        required_fields:
            atributosObrigatoriosFaltando,

        required_field_names:
            atributosObrigatoriosFaltando.map(
                attribute =>
                    attribute.name ||
                    attribute.id
            ),

        item_origem:
            item.id,

        category_id:
            item.category_id

    });

}

           // =================================================
// VARIAÇÕES
// =================================================

// IMPORTANTE:
// O Mercado Livre não permite enviar "variations"
// junto com "family_name".

if (
    !familyName &&
    Array.isArray(item.variations) &&
    item.variations.length > 0
) {

    const variations =
        item.variations
            .map(variation => {

                const attributeCombinations =
                    Array.isArray(
                        variation.attribute_combinations
                    )
                        ? variation.attribute_combinations
                            .filter(
                                attribute =>
                                    attribute &&
                                    attribute.id &&
                                    (
                                        attribute.value_id ||
                                        attribute.value_name
                                    )
                            )
                            .map(attribute => {

                                const resultado = {
                                    id: attribute.id
                                };

                                if (attribute.value_id) {
                                    resultado.value_id =
                                        attribute.value_id;
                                }

                                if (attribute.value_name) {
                                    resultado.value_name =
                                        attribute.value_name;
                                }

                                return resultado;
                            })
                        : [];

                return {
                    attribute_combinations:
                        attributeCombinations,

                    price:
                        Number(
                            variation.price ||
                            item.price ||
                            0
                        ),

                    available_quantity: 0,

                    picture_ids:
                        Array.isArray(
                            variation.picture_ids
                        )
                            ? variation.picture_ids
                            : []
                };
            })
            .filter(
                variation =>
                    variation.attribute_combinations.length > 0
            );

    if (variations.length > 0) {

        novoItem.variations =
            variations;

        console.log(
            "🔄 Variações copiadas:",
            variations.length
        );
    }

} else if (familyName) {

    console.log(
        "👨‍👩‍👧 family_name detectado:",
        familyName,
        "→ variações não serão enviadas."
    );
}


            // ====================================================
            // REMOVER VALORES VAZIOS
            // ====================================================

            Object.keys(novoItem).forEach(
                key => {

                    if (
                        novoItem[key] === undefined ||
                        novoItem[key] === null
                    ) {

                        delete novoItem[key];

                    }

                }
            );


            console.log(
                "📦 Dados enviados para criação:",
                JSON.stringify(
                    novoItem,
                    null,
                    2
                )
            );


            // ====================================================
            // CRIAR NOVO ANÚNCIO
            // ====================================================

            let novoAnuncio;


            try {

                console.log("🔐 TESTANDO TOKEN ML...");

try {
    const meResponse = await axios.get(
        "https://api.mercadolibre.com/users/me",
        {
            headers
        }
    );

    console.log(
        "✅ TOKEN OK:",
        JSON.stringify({
            id: meResponse.data?.id,
            nickname: meResponse.data?.nickname
        }, null, 2)
    );

} catch (tokenError) {

    console.error(
        "❌ TOKEN NÃO TEM ACESSO:",
        JSON.stringify(
            tokenError.response?.data ||
            tokenError.message,
            null,
            2
        )
    );

    throw tokenError;
}


console.log(
    "🧪 TESTE CAMPOS DE PUBLICAÇÃO:",
    JSON.stringify({
        title: novoItem.title,
        family_name: novoItem.family_name,
        category_id: novoItem.category_id,
        listing_type_id: novoItem.listing_type_id,
        condition: novoItem.condition,
        attributes_count: novoItem.attributes?.length || 0
    }, null, 2)
);
                const createResponse =
                    await axios.post(
                        "https://api.mercadolibre.com/items",
                        novoItem,
                        {
                            headers: {

                                ...headers,

                                "Content-Type":
                                    "application/json"

                            }
                        }
                    );


                novoAnuncio =
                    createResponse.data;


            } catch (createError) {

                console.error(
    "🚨 ERRO COMPLETO DO MERCADO LIVRE:",
    JSON.stringify(
        createError.response?.data,
        null,
        2
    )
);

                const erroML =
                    createError.response?.data ||
                    null;


                console.error(
                    "❌ Mercado Livre recusou criação:",
                    JSON.stringify(
                        erroML ||
                        createError.message,
                        null,
                        2
                    )
                );


                return res.status(
                    createError.response?.status ||
                    500
                ).json({

                    ok: false,

                    reason:
                        "create_item_error",

                    message:
                        erroML?.message ||
                        erroML?.error ||
                        createError.message ||
                        "Mercado Livre recusou a criação do anúncio.",

                    details:
                        erroML,

                    item_origem:
                        item.id,

                    dados_enviados: {

                        title:
                            novoItem.title,

                        category_id:
                            novoItem.category_id,

                        price:
                            novoItem.price,

                        condition:
                            novoItem.condition,

                        listing_type_id:
                            novoItem.listing_type_id,

                        pictures:
                            novoItem.pictures?.length ||
                            0,

                        attributes:
                            novoItem.attributes?.length ||
                            0,

                        variations:
                            novoItem.variations?.length ||
                            0

                    }

                });

            }


            // ====================================================
            // ESTOQUE ZERO
            // ====================================================

            let estoqueAtualizado =
                false;


            try {

                const updateResponse =
                    await axios.put(
                        `https://api.mercadolibre.com/items/${novoAnuncio.id}`,
                        {
                            available_quantity:
                                0
                        },
                        {
                            headers: {

                                ...headers,

                                "Content-Type":
                                    "application/json"

                            }
                        }
                    );


                if (
                    updateResponse.data &&
                    Number(
                        updateResponse.data
                            .available_quantity
                    ) === 0
                ) {

                    estoqueAtualizado =
                        true;

                }

            } catch (stockError) {

                console.warn(
                    "⚠️ Não foi possível colocar estoque zero:",
                    stockError.response?.data ||
                    stockError.message
                );

            }


            // ====================================================
            // COPIAR DESCRIÇÃO
            // ====================================================

            let descricaoCriada =
                false;


            if (
                descricao &&
                descricao.trim()
            ) {

                try {

                    await axios.post(
                        `https://api.mercadolibre.com/items/${novoAnuncio.id}/description`,
                        {
                            plain_text:
                                descricao
                        },
                        {
                            headers: {

                                ...headers,

                                "Content-Type":
                                    "application/json"

                            }
                        }
                    );


                    descricaoCriada =
                        true;


                } catch (descriptionCreateError) {

                    console.warn(
                        "⚠️ Erro ao copiar descrição:",
                        descriptionCreateError.response?.data ||
                        descriptionCreateError.message
                    );

                }

            }


            // ====================================================
            // LOG
            // ====================================================

            try {

                await supabase
                    .from("logs")
                    .insert({

                        company_id:
                            company.id,

                        acao:
                            "mercadolivre_anuncio_clonado",

                        detalhes: {

                            anuncio_origem:
                                item.id,

                            anuncio_novo:
                                novoAnuncio.id,

                            titulo:
                                item.title,

                            estoque:
                                0,

                            descricao_copiada:
                                descricaoCriada,

                            estoque_atualizado:
                                estoqueAtualizado

                        }

                    });

            } catch (logError) {

                console.warn(
                    "⚠️ Não foi possível registrar log da clonagem:",
                    logError
                );

            }


            // ====================================================
            // SUCESSO
            // ====================================================

            return res.json({

                ok: true,

                modo:
                    "clonado",

                item_id:
                    novoAnuncio.id,

                id:
                    novoAnuncio.id,

                permalink:
                    novoAnuncio.permalink ||
                    `https://www.mercadolivre.com.br/p/${novoAnuncio.id}`,

                title:
                    novoAnuncio.title,

                estoque:
                    0,

                estoque_atualizado:
                    estoqueAtualizado,

                descricao_copiada:
                    descricaoCriada,

                anuncio_origem:
                    item.id

            });


        } catch (error) {

            console.error(
                "❌ Erro geral ao clonar anúncio:",
                error.response?.data ||
                error.message ||
                error
            );


            if (error.statusCode) {

                return res.status(
                    error.statusCode
                ).json({

                    ok: false,

                    reason:
                        error.reason,

                    message:
                        error.message

                });

            }


            if (error.response) {

                return res.status(
                    error.response.status ||
                    500
                ).json({

                    ok: false,

                    reason:
                        "mercadolivre_api_error",

                    message:
                        error.response.data?.message ||
                        "Erro ao consultar Mercado Livre",

                    details:
                        error.response.data ||
                        null

                });

            }


            return res.status(500).json({

                ok: false,

                reason:
                    "clone_error",

                message:
                    error.message ||
                    "Erro interno ao clonar anúncio.",

                details:
                    error.response?.data ||
                    null

            });

        }

    }
);

app.post("/api/mercadolivre/notificacoes", async (req, res) => {
    console.log("📩 Notificação Mercado Livre:", req.body);
    return res.status(200).send("OK");
});

const server = app.listen(PORT, () => {
    console.log(`API rodando em http://localhost:${PORT}`);
});

// ==========================================
// 🔌 WEBSOCKET
// ==========================================

const wss = new WebSocketServer({
    server
});

const connectedDevices = new Map();

wss.on("connection", (ws) => {

    console.log("🔌 Novo dispositivo conectado");

    let deviceId = null;

    ws.on("message", (message) => {

        try {

            const data = JSON.parse(
                message.toString()
            );

            console.log(
                "📩 WebSocket:",
                data
            );

            if (data.type === "register") {

                if (!data.device_id) {
                    return;
                }

                deviceId = data.device_id;

                connectedDevices.set(
                    deviceId,
                    ws
                );

                console.log(
                    `📱 Dispositivo conectado: ${deviceId}`
                );

                ws.send(JSON.stringify({
                    type: "registered",
                    device_id: deviceId
                }));
            }

        } catch (error) {

            console.error(
                "Erro WebSocket:",
                error
            );

        }
    });

    ws.on("close", () => {

        if (deviceId) {

            if (
                connectedDevices.get(deviceId) === ws
            ) {
                connectedDevices.delete(deviceId);
            }

            console.log(
                `📴 Dispositivo desconectado: ${deviceId}`
            );
        }

    });

    ws.on("error", (error) => {

        console.error(
            "WebSocket error:",
            error
        );

    });

});