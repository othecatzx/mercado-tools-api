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
            "Conta Mercado Livre não conectada"
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
// MERCADO LIVRE - GERENCIADOR DE TOKEN
// ============================================================

async function getValidMercadoLivreToken(companyId) {

    if (!companyId) {
        throw new Error("companyId é obrigatório");
    }

    // ========================================================
    // BUSCAR CONTA
    // ========================================================

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
            "Conta Mercado Livre não conectada"
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
    // VERIFICAR EXPIRAÇÃO
    // ========================================================

    const expiresAt =
        account.token_expires_at
            ? new Date(
                account.token_expires_at
            ).getTime()
            : 0;

    const agora = Date.now();

    // Renovar somente quando estiver expirado
    // ou faltando menos de 5 minutos.
    const margemRenovacao =
        5 * 60 * 1000;

    if (
        expiresAt > 0 &&
        agora < expiresAt - margemRenovacao
    ) {

        return account.access_token;
    }


    // ========================================================
    // TOKEN EXPIRADO / PRÓXIMO DE EXPIRAR
    // ========================================================

    console.log(
        `🔄 Renovando token Mercado Livre | Empresa: ${companyId}`
    );


    try {

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


        // ====================================================
        // NOVA EXPIRAÇÃO
        // ====================================================

        const expiresIn =
            Number(
                tokenData.expires_in || 21600
            );

        const tokenExpiresAt =
            new Date(
                Date.now() +
                expiresIn * 1000
            ).toISOString();


        // ====================================================
        // ATUALIZAR SUPABASE
        // ====================================================

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
                "❌ Erro ao atualizar tokens ML:",
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


        // ====================================================
        // REFRESH TOKEN INVÁLIDO
        // ====================================================

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
    }
}

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
            .select("id, device_id, status, company_id")
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


        return res.json({

            configured: !!(
                ML_CLIENT_ID &&
                ML_CLIENT_SECRET &&
                ML_REDIRECT_URI
            ),

            connected: !!account,

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
// TESTE - MERCADO LIVRE API
// ============================================================

app.get("/api/mercadolivre/test", async (req, res) => {

    try {

        const {
            chave,
            device_id
        } = req.query;

        if (!chave || !device_id) {

            return res.status(400).json({
                ok: false,
                reason: "missing_data",
                message:
                    "chave e device_id são obrigatórios"
            });
        }

        // ====================================================
        // BUSCAR LICENÇA
        // ====================================================

        const { data: license, error: licenseError } =
            await supabase
                .from("licenses")
                .select("*")
                .eq("chave", chave)
                .maybeSingle();

        if (licenseError) {

            console.error(
                "Erro ao buscar licença:",
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

        if (license.status !== "active") {

            return res.status(403).json({
                ok: false,
                reason: "license_inactive"
            });
        }

        if (
            license.vencimento &&
            new Date(
                license.vencimento
            ).getTime() < Date.now()
        ) {

            return res.status(403).json({
                ok: false,
                reason: "license_expired"
            });
        }

        // ====================================================
        // VALIDAR DISPOSITIVO
        // ====================================================

        const { data: device, error: deviceError } =
            await supabase
                .from("devices")
                .select(
                    "id, device_id, status, company_id"
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
                "Erro ao buscar dispositivo:",
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
                reason: "device_not_registered"
            });
        }

        if (device.status !== "active") {

            return res.status(403).json({
                ok: false,
                reason: "device_inactive"
            });
        }

        // ====================================================
        // PEGAR TOKEN VÁLIDO
        // ====================================================

        const accessToken =
            await getValidMercadoLivreToken(
                license.company_id
            );

        // ====================================================
        // TESTAR API DO MERCADO LIVRE
        // ====================================================

        const response =
            await axios.get(
                "https://api.mercadolibre.com/users/me",
                {
                    headers: {
                        Authorization:
                            `Bearer ${accessToken}`
                    }
                }
            );

        const user =
            response.data;

        // ====================================================
        // NÃO RETORNAR TOKEN
        // ====================================================

        return res.json({

            ok: true,

            message:
                "Mercado Livre API funcionando",

            account: {

                id:
                    user.id,

                nickname:
                    user.nickname,

                country_id:
                    user.country_id,

                site_id:
                    user.site_id

            }

        });

    } catch (error) {

        console.error(
            "❌ Erro no teste Mercado Livre:",
            error.response?.data ||
            error.message
        );

        return res.status(500).json({

            ok: false,

            reason:
                "mercadolivre_api_error",

            message:
                error.message

        });

    }

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