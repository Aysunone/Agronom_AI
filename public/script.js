
"use strict";

const $ = (selector) => document.querySelector(selector);

const form = $("#analysis-form");
const photo = $("#photo");
const drop = $("#drop");
const preview = $("#preview");
const dropTitle = $("#drop-title");
const analyzeBtn = $("#analyze-btn");
const errorBox = $("#error");
const result = $("#result");

const chatForm = $("#chat-form");
const question = $("#question");
const sendBtn = $("#send-btn");
const messages = $("#messages");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

let selectedFile = null;
let busyAnalysis = false;
let busyChat = false;
let currentAnalysis = null;
let chatHistory = [];

function element(tag, className, text) {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

function showError(message = "") {
    errorBox.textContent = message;
    errorBox.hidden = !message;
}

function addMessage(text, role) {
    const node = element(
        "div",
        role === "user" ? "m user-message" : "m assistant-message",
        text
    );

    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;

    return node;
}

function validateImage(file) {
    if (!file) {
        throw new Error("Əvvəlcə şəkil seç.");
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error("Yalnız JPG, PNG və WEBP şəkilləri qəbul edilir.");
    }

    if (file.size > MAX_FILE_SIZE) {
        throw new Error("Şəkil 5 MB-dan böyük olmamalıdır.");
    }

    if (file.size === 0) {
        throw new Error("Seçilən fayl boşdur.");
    }
}

function clearPreview() {
    preview.removeAttribute("src");
    preview.hidden = true;
    dropTitle.hidden = false;
    drop.classList.remove("has-image");
}

function selectImage(file) {
    try {
        validateImage(file);

        selectedFile = file;
        preview.src = URL.createObjectURL(file);
        preview.hidden = false;
        dropTitle.hidden = true;
        drop.classList.add("has-image");
        showError("");
    } catch (error) {
        selectedFile = null;
        photo.value = "";
        clearPreview();
        showError(error.message);
    }
}

photo.addEventListener("change", () => {
    const file = photo.files?.[0];

    if (file) selectImage(file);
});

["dragenter", "dragover"].forEach((eventName) => {
    drop.addEventListener(eventName, (event) => {
        event.preventDefault();
        drop.classList.add("over");
    });
});

["dragleave", "drop"].forEach((eventName) => {
    drop.addEventListener(eventName, (event) => {
        event.preventDefault();
        drop.classList.remove("over");
    });
});

drop.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];

    if (!file) return;

    try {
        validateImage(file);

        // Drop ilə seçilən faylı formaya da əlavə et.
        const transfer = new DataTransfer();
        transfer.items.add(file);
        photo.files = transfer.files;

        selectImage(file);
    } catch (error) {
        showError(error.message);
    }
});

// Şəkli brauzerdə kiçildir. API-yə orijinal böyük fayl göndərilmir.
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            try {
                const maxDimension = 1280;
                const scale = Math.min(
                    1,
                    maxDimension / Math.max(image.width, image.height)
                );

                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));

                const context = canvas.getContext("2d");

                if (!context) throw new Error("Şəkil emal edilə bilmədi.");

                context.drawImage(
                    image,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                canvas.toBlob(
                    (blob) => {
                        URL.revokeObjectURL(objectUrl);

                        if (!blob) {
                            reject(new Error("Şəkli hazırlamaq mümkün olmadı."));
                            return;
                        }

                        resolve(blob);
                    },
                    "image/jpeg",
                    0.82
                );
            } catch (error) {
                URL.revokeObjectURL(objectUrl);
                reject(error);
            }
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Şəkli oxumaq mümkün olmadı."));
        };

        image.src = objectUrl;
    });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const value = String(reader.result);
            const comma = value.indexOf(",");

            if (comma < 0) {
                reject(new Error("Şəkil məlumatı oxunmadı."));
                return;
            }

            resolve(value.slice(comma + 1));
        };

        reader.onerror = () => reject(new Error("Şəkil oxunmadı."));
        reader.readAsDataURL(blob);
    });
}

async function requestAI(payload) {
    const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("Sorğu limiti dolub. Bir az sonra yenidən yoxla.");
        }

        throw new Error(data.error || "AI serverindən cavab alınmadı.");
    }

    if (typeof data.answer !== "string" || !data.answer.trim()) {
        throw new Error("AI boş cavab göndərdi. Yenidən cəhd et.");
    }

    return data.answer;
}

function setSection(title, text) {
    const section = element("section", "sec");
    section.append(
        element("h3", "", title),
        element("p", "", text || "Məlumat müəyyən edilmədi.")
    );

    result.appendChild(section);
}

function renderAnalysis(data) {
    result.replaceChildren();

    result.append(
        element("span", "eyebrow", "ANALİZ HESABATI"),
        element("h2", "", "Nəticə")
    );

    const urgent = data.tecili === true;

    result.append(
        element(
            "span",
            urgent ? "badge urgent" : "badge",
            urgent ? "Təcili baytar müayinəsi lazımdır" : "İlkin qiymətləndirmə"
        ),
        element("div", "diag", data.ad || "Əlamət aydın deyil")
    );

    const meter = element("div", "meter");
    meter.setAttribute("role", "img");
    meter.setAttribute(
        "aria-label",
        "Modelin təxmin etdiyi əminlik: " + data.etibar + " faiz"
    );

    const filled = Math.round(data.etibar / 10);

    for (let i = 0; i < 10; i++) {
        meter.appendChild(element("i", i < filled ? "on" : ""));
    }

    result.append(
        meter,
        element(
            "p",
            "small",
            "AI-nin əlamətlərə dair təxmini qiymətləndirməsi: " +
            data.etibar +
            "%. Bu rəqəm klinik diaqnostik dəqiqlik göstəricisi deyil."
        )
    );

    setSection("Görünən əlamətlər", data.izah);
    setSection("Növbəti addımlar", data.mualice);
    setSection("Qidalanma və qulluq", data.yem_qeyd);

    const note = element(
        "p",
        "note",
        urgent
            ? "Heyvanı mümkün qədər tez baytara göstər. İnsanlara və digər heyvanlara təhlükə ehtimalı varsa, baytarın göstərişlərinə əməl et."
            : "Şəkil əsasında qəti diaqnoz qoymaq mümkün deyil. Əlamətlər davam edirsə və ya ağırlaşırsa, baytara müraciət et."
    );

    result.appendChild(note);
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (busyAnalysis) return;

    const animal = $("#type").value;
    const weight = $("#weight").value;
    const milk = $("#milk").value;
    const symptoms = $("#symptoms").value.trim();

    if (!selectedFile) {
        showError("Analiz üçün heyvanın şəklini seç.");
        return;
    }

    if (weight && !(Number(weight) > 0 && Number(weight) <= 3000)) {
        showError("Çəkini 1–3000 kq aralığında daxil et.");
        return;
    }

    if (milk && !(Number(milk) >= 0 && Number(milk) <= 150)) {
        showError("Süd miqdarını 0–150 litr aralığında daxil et.");
        return;
    }

    busyAnalysis = true;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analiz edilir...";
    showError("");

    try {
        const imageBlob = await compressImage(selectedFile);
        const image = await blobToBase64(imageBlob);

        const answer = await requestAI({
            mode: "analyze",
            message: "Heyvanın sağlamlığına dair ilkin şəkil qiymətləndirməsi apar.",
            animal,
            weight: weight ? Number(weight) : null,
            milk: milk ? Number(milk) : null,
            symptoms,
            image: {
                mimeType: "image/jpeg",
                data: image
            }
        });

        // Server analiz cavabını JSON formatında mətn kimi qaytarır.
        let data;

        try {
            data = JSON.parse(answer);
        } catch {
            throw new Error("Analiz nəticəsinin formatı düzgün deyil. Yenidən cəhd et.");
        }

        const confidence = Number(data.etibar);

        currentAnalysis = {
            ad: String(data.ad || "Aydın deyil").slice(0, 200),
            etibar: Number.isFinite(confidence)
                ? Math.max(0, Math.min(100, Math.round(confidence)))
                : 0,
            izah: String(data.izah || "").slice(0, 1500),
            mualice: String(data.mualice || "").slice(0, 1500),
            yem_qeyd: String(data.yem_qeyd || "").slice(0, 1000),
            tecili: data.tecili === true
        };

        renderAnalysis(currentAnalysis);

    } catch (error) {
        showError(error.message || "Analiz alınmadı.");
    } finally {
        busyAnalysis = false;
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "Şəkli analiz et";
    }
});

function getContext() {
    if (!currentAnalysis) return "Şəkil analizi aparılmayıb.";

    return [
        "Son ilkin analiz:",
        "Mümkün vəziyyət: " + currentAnalysis.ad,
        "Əlamətlər: " + currentAnalysis.izah,
        "Təcili baytar xəbərdarlığı: " +
        (currentAnalysis.tecili ? "Bəli" : "AI təcili xəbərdarlıq verməyib")
    ].join("\n");
}

async function askAssistant(text) {
    if (busyChat) return;

    const userText = text.trim();

    if (!userText || userText.length > 2000) return;

    busyChat = true;
    sendBtn.disabled = true;
    question.disabled = true;

    addMessage(userText, "user");
    const loading = addMessage("Cavab hazırlanır...", "assistant");

    const history = chatHistory.slice(-8);

    try {
        const answer = await requestAI({
            mode: "chat",
            message: userText,
            context: getContext(),
            history
        });

        loading.textContent = answer;

        chatHistory.push(
            { role: "user", text: userText },
            { role: "assistant", text: answer }
        );

        chatHistory = chatHistory.slice(-10);
    } catch (error) {
        loading.textContent = error.message || "Cavab almaq mümkün olmadı.";
    } finally {
        busyChat = false;
        sendBtn.disabled = false;
        question.disabled = false;
        question.focus();
    }
}

chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = question.value.trim();

    if (!text) return;

    question.value = "";
    askAssistant(text);
});

$("#chips").addEventListener("click", (event) => {
    const button = event.target.closest("[data-question]");

    if (!button || busyChat) return;

    askAssistant(button.dataset.question);
});
