-- Zuperming Freemium Secure Loader v5.0
-- ╔══════════════════════════════════════════════════════════╗
-- ║  ANTI-TAMPER VM LAYER — DO NOT DECOMPILE OR REDISTRIBUTE ║
-- ╚══════════════════════════════════════════════════════════╝
repeat task.wait() until game:IsLoaded()
repeat task.wait() until game.Players.LocalPlayer and game.Players.LocalPlayer.Character

-- ── [VM] Reference isolation: all service refs through cloneref where possible ──
local _game          = typeof(cloneref) == "function" and cloneref(game) or game
local _Players       = _game:GetService("Players")
local _HttpService   = _game:GetService("HttpService")
local _StarterGui    = _game:GetService("StarterGui")
local _RbxAnalytics  = _game:GetService("RbxAnalyticsService")
local _LocalPlayer   = _Players.LocalPlayer

-- ── [VM] Anti-dump: proxy all sensitive values through closures ──
local function _protect(fn) return (function(...) return fn(...) end) end

local function _notify(title, text, dur)
    pcall(function()
        _StarterGui:SetCore("SendNotification", {
            Title = title,
            Text = text or "",
            Duration = dur or 4
        })
    end)
end

-- ── [VM] Integrity check: detect hooking of loadstring / game:HttpGet ──
local function _integrityCheck()
    local ok1 = pcall(function()
        local fn, _ = loadstring("return 1")
        assert(type(fn) == "function", "hook")
        assert(fn() == 1, "hook")
    end)
    local ok2 = typeof(_game.HttpGet) == "function"
    return ok1 and ok2
end

if not _integrityCheck() then
    _LocalPlayer:Kick("[Zuperming Free] Integrity check failed. Do not tamper with executor functions.")
    return
end

-- ── [VM] Freemium: key is optional — KEYLESS_FREE used if not set ──
local _env = {}
_env["\x73\x63\x72\x69\x70\x74\x5f\x6b\x65\x79"] = (function()
    return script_key or (getgenv and getgenv().script_key) or _G.script_key or _G.key
end)()
local ZUPER_KEY = _env["\x73\x63\x72\x69\x70\x74\x5f\x6b\x65\x79"] or "KEYLESS_FREE"

-- ── [VM] Executor fingerprint ──
local function _detectExecutor()
    local name = "Unknown"
    pcall(function()
        if identifyexecutor then name = tostring(identifyexecutor())
        elseif getexecutorname then name = tostring(getexecutorname())
        end
    end)

    local checks = {
        function() return request ~= nil or http_request ~= nil or (syn and syn.request) or (http and http.request) end,
        function() return crypt ~= nil and (crypt.encrypt ~= nil or crypt.hash ~= nil) end,
        function() return writefile ~= nil and readfile ~= nil and isfile ~= nil end,
        function() return getgenv ~= nil end,
        function() return gethui ~= nil or get_hidden_gui ~= nil end,
        function() return cloneref ~= nil end,
        function() return hookmetamethod ~= nil end,
        function() return Drawing ~= nil and Drawing.new ~= nil end,
        function() return setclipboard ~= nil or toclipboard ~= nil end,
        function() return WebSocket ~= nil and WebSocket.connect ~= nil end,
        function() return newcclosure ~= nil end,
        function() return checkcaller ~= nil end,
    }

    local passed = 0
    for _, fn in ipairs(checks) do
        local ok, res = pcall(fn)
        if ok and res then passed = passed + 1 end
    end

    local total = #checks
    local ratio = passed / total
    local quality = ratio >= 0.7 and "good" or (ratio >= 0.45 and "medium" or "bad")
    return name, quality, passed, total
end

local execName, execQuality, execScore, execTotal = _detectExecutor()

if execQuality == "bad" or execQuality == "medium" then
    _notify("Zuperming Free", "WARNING: Change your executor! UNC/sUNC weak.", 6)
    warn("[Zuperming Free] Executor quality: " .. execQuality .. " — please use a better executor.")
end

-- ── [VM] HWID collection ──
local hwid = ""
pcall(function()
    if gethwid then
        hwid = tostring(gethwid())
    else
        hwid = tostring(_RbxAnalytics:GetClientId())
    end
end)

local placeId    = tostring(_game.PlaceId)
local universeId = tostring(_game.GameId)

-- ── [VM] URL construction — split to resist static analysis ──
local _base = "{{BASE_URL}}"
local _p1   = "/api/free/execute?key="
local _p2   = "&hwid="
local _p3   = "&game_id="
local _p4   = "&place_id="
local _p5   = "&executor="
local _p6   = "&unc_quality="
local _p7   = "&unc_score="
local _p8   = "&unc_total="

local apiUrl = _base .. _p1 .. ZUPER_KEY
    .. _p2 .. hwid
    .. _p3 .. universeId
    .. _p4 .. placeId
    .. _p5 .. _HttpService:UrlEncode(tostring(execName))
    .. _p6 .. execQuality
    .. _p7 .. tostring(execScore)
    .. _p8 .. tostring(execTotal)

-- Clear key from memory after URL build
ZUPER_KEY = nil
_env = nil

_notify("Zuperming Free", "Authenticating...")
task.wait(0.5)

local ok, result = pcall(function()
    return _game:HttpGet(apiUrl)
end)

apiUrl = nil

if not ok then
    _notify("Zuperming Free", "Server connection failed.", 4)
    _LocalPlayer:Kick("[Zuperming Free] Failed to reach secure server.")
    return
end

if type(result) ~= "string" or #result < 8 then
    _notify("Zuperming Free", "Invalid server response.", 4)
    _LocalPlayer:Kick("[Zuperming Free] Server returned invalid response.")
    return
end

if result:find("Zuperming:") and result:find("Kick") then
    _notify("Zuperming Free", "Authentication failed.", 4)
    pcall(loadstring(result))
    return
end

_notify("Zuperming Free", "Key validated! Loading...")

local fn, compileErr = loadstring(result)
result = nil

if not fn then
    _notify("Zuperming Free", "Script load error.", 4)
    warn("[Zuperming Free] Compile error: " .. tostring(compileErr))
    return
end

local runOk, runtimeErr = pcall(fn)
fn = nil

if not runOk then
    pcall(function()
        local req = request or http_request or (syn and syn.request) or (http and http.request)
        if req then
            req({
                Url = _base .. "/api/report-error",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = _HttpService:JSONEncode({
                    error = tostring(runtimeErr):sub(1, 500),
                    executor = tostring(execName),
                    hwid = tostring(hwid),
                    game_id = tostring(universeId),
                    product = "freemium"
                })
            })
        end
    end)
    warn("[Zuperming Free] Runtime error: " .. tostring(runtimeErr))
end
