import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { LanguageGate } from "./components/LanguageGate";
import { I18nProvider } from "./i18n";

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

function type(label: string, value: string) {
  const el = input(label);
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

describe("App with the simulated radio (no Web Serial in jsdom)", () => {
  beforeEach(() => {
    localStorage.setItem("ce42.lang", "pt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reads the radio, edits a channel and writes it back", async () => {
    render(<I18nProvider><App /></I18nProvider>);
    expect(screen.getByText("0 de 500 canais ativos")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ler do rádio" }));
    await screen.findByText(/Leitura concluída\. Firmware 0108/, undefined, { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Concluído" }));
    expect(input("Tag 001").value).toBe("PY CALL");
    const mode = screen.getByLabelText("Modo 001") as HTMLSelectElement;
    expect(mode.selectedOptions[0]?.textContent).toBe("LSB");
    expect([...mode.options].map((o) => o.textContent)).toEqual(["LSB", "USB", "CW", "AM", "DATA"]);
    expect(input("RX (MHz) 003").value).toBe("14.20000");
    expect(screen.getByText("5 de 500 canais ativos")).toBeTruthy();

    // new channel: typing a frequency enables it and TX follows RX
    type("Tag 006", "teste 6");
    type("RX (MHz) 006", "3,5");
    expect(input("Ativo 006").checked).toBe(true);
    expect(input("Tag 006").value).toBe("TESTE 6");
    expect(input("TX (MHz) 006").value).toBe("3.50000");
    // below the 0.5 MHz RX limit is clamped like the CE42 grid editor
    type("RX (MHz) 002", "0.1");
    expect(input("RX (MHz) 002").value).toBe("0.50000");

    fireEvent.click(screen.getByRole("button", { name: "Gravar no rádio" }));
    await screen.findByText(/Gravação concluída e conferida/, undefined, { timeout: 15000 });
    fireEvent.click(screen.getByRole("button", { name: "Concluído" }));
    expect(input("Tag 006").value).toBe("TESTE 6");
    expect(screen.getByText("6 de 500 canais ativos")).toBeTruthy();
  });

  it("asks for the language at start-up and remembers it", () => {
    localStorage.setItem("ce42.lang", "ru");
    render(<I18nProvider><LanguageGate><App /></LanguageGate></I18nProvider>);
    const options = screen.getAllByRole("button").map((b) => b.textContent);
    expect(options).toEqual(["Português", "English", "Español", "Русский"]);
    expect(document.activeElement?.textContent).toBe("Русский"); // last choice preselected
    expect(screen.getByText(/^By PP5KJ - Ver \d+\.\d+\.\d+ - \d{2}\.\d{2}\.\d{4}$/)).toBeTruthy(); // Russian date format
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(screen.getByRole("button", { name: "Leer de la radio" })).toBeTruthy();
    expect(localStorage.getItem("ce42.lang")).toBe("es");
    cleanup();
    render(<I18nProvider><LanguageGate><App /></LanguageGate></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Русский" }));
    expect(screen.getByRole("button", { name: "Считать из рации" })).toBeTruthy();
    expect(screen.getByText("Активно каналов: 0 из 500")).toBeTruthy();
  });

  it("credits PP5KJ with version and build date in the footer and the Radio tab", () => {
    render(<I18nProvider><App /></I18nProvider>);
    const credit = /^By PP5KJ - Ver \d+\.\d+\.\d+ - \d{2}\/\d{2}\/\d{4}$/;
    expect(screen.getAllByText(credit)).toHaveLength(1); // footer
    fireEvent.click(screen.getByRole("tab", { name: "Rádio" }));
    expect(screen.getAllByText(credit)).toHaveLength(2); // footer + Radio tab
    expect(screen.getByRole("heading", { level: 2, name: "CE42 Next" })).toBeTruthy();
  });

  it("explains every option with a ? button", () => {
    render(<I18nProvider><App /></I18nProvider>);
    // channel columns
    const columnHelp = screen.getAllByRole("button", { name: "Ajuda" });
    expect(columnHelp).toHaveLength(12);
    fireEvent.mouseEnter(columnHelp[7]!); // power column
    expect(screen.getByRole("tooltip").textContent).toMatch(/20 W/);
    fireEvent.mouseLeave(columnHelp[7]!);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // every setting has its own help
    fireEvent.click(screen.getByRole("tab", { name: "Configurações" }));
    const settingsHelp = screen.getAllByRole("button", { name: "Ajuda" });
    expect(settingsHelp.length).toBeGreaterThanOrEqual(25);
    fireEvent.focus(settingsHelp[0]!);
    expect(screen.getByRole("tooltip").textContent).toMatch(/sintonizador interno ATU-1210/);
    fireEvent.click(screen.getByRole("tab", { name: "Selcall e Telcall" }));
    expect(screen.getAllByRole("button", { name: "Ajuda" }).length).toBeGreaterThanOrEqual(22 + 8);
  });

  it("clamps TX to the 1.6 MHz minimum and writes", async () => {
    render(<I18nProvider><App /></I18nProvider>);
    fireEvent.click(input("Ativo 001"));
    type("RX (MHz) 001", "7.1");
    // like the CE42 grid editor, a TX below 1.6 MHz is raised to the minimum
    type("TX (MHz) 001", "1.0");
    expect(input("TX (MHz) 001").value).toBe("1.60000");
    fireEvent.click(screen.getByRole("button", { name: "Gravar no rádio" }));
    await screen.findByText(/Gravação concluída/, undefined, { timeout: 15000 });
  });
});
