import {
  ChartColumn, Check, CircleAlert, CircleOff, CreditCard, ExternalLink, Info, Link, Mail, Plus,
  RefreshCw, Save, Scissors, Send, Trash2, TriangleAlert,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { ACTION_ICONS, TONE_ICONS } from "./resolveCardIcons";

describe("resolveCardIcons", () => {
  it("IC-01 ACTION_ICONS holds exactly the 13 catalog names", () => {
    expect(Object.keys(ACTION_ICONS).sort()).toEqual([
      "bar-chart", "check", "circle-off", "credit-card", "external-link", "link",
      "mail", "plus", "refresh-cw", "save", "scissors", "send", "trash",
    ]);
  });

  it("IC-02 each action name maps to its lucide component", () => {
    expect(ACTION_ICONS["bar-chart"]).toBe(ChartColumn);
    expect(ACTION_ICONS.check).toBe(Check);
    expect(ACTION_ICONS["circle-off"]).toBe(CircleOff);
    expect(ACTION_ICONS["credit-card"]).toBe(CreditCard);
    expect(ACTION_ICONS["external-link"]).toBe(ExternalLink);
    expect(ACTION_ICONS.link).toBe(Link);
    expect(ACTION_ICONS.mail).toBe(Mail);
    expect(ACTION_ICONS.plus).toBe(Plus);
    expect(ACTION_ICONS["refresh-cw"]).toBe(RefreshCw);
    expect(ACTION_ICONS.save).toBe(Save);
    expect(ACTION_ICONS.scissors).toBe(Scissors);
    expect(ACTION_ICONS.send).toBe(Send);
    expect(ACTION_ICONS.trash).toBe(Trash2);
  });

  it("IC-03 each tone maps to its tone icon", () => {
    expect(TONE_ICONS.blocking).toBe(TriangleAlert);
    expect(TONE_ICONS.failed).toBe(CircleAlert);
    expect(TONE_ICONS.waiting).toBe(Mail);
    expect(TONE_ICONS.info).toBe(Info);
    expect(Object.keys(TONE_ICONS).sort()).toEqual(["blocking", "failed", "info", "waiting"]);
  });
});
