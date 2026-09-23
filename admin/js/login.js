const API_URL = "http://localhost:3000";

const form = document.getElementById("loginForm");
const button = document.getElementById("loginButton");
const status = document.getElementById("loginStatus");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;

    button.disabled = true;
    button.textContent = "Entrando...";
    status.textContent = "";

    try {
        const response = await fetch(`${API_URL}/api/admin/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email,
                senha
            })
        });

        const data = await response.json();

        if (!response.ok || !data.authorized) {
            status.textContent = "E-mail ou senha inválidos.";
            status.style.color = "#dc2626";

            return;
        }

        // Salvar sessão
        localStorage.setItem("admin_token", data.token);
        localStorage.setItem(
            "admin_user",
            JSON.stringify(data.admin)
        );

        status.textContent = "Login realizado!";
        status.style.color = "#16a34a";

        // Ir para o painel
        window.location.href = "index.html";

    } catch (error) {

        console.error(error);

        status.textContent =
            "Não foi possível conectar ao servidor.";

        status.style.color = "#dc2626";

    } finally {

        button.disabled = false;
        button.textContent = "Entrar";
    }
});