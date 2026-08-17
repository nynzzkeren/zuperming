-- Zuperming Secure Loader
repeat task.wait() until game.Players.LocalPlayer and game.Players.LocalPlayer.Character
if not game:IsLoaded() then game.Loaded:Wait() end

local g = game
local s = g:GetService("StarterGui")
local n = function(t,d) pcall(function() s:SetCore("SendNotification",{Title="Zuperming",Text=t,Duration=d or 3}) end) end

local ZUPER_KEY = _G.key_script
if not ZUPER_KEY then
    n("Key not found!", 4)
    g.Players.LocalPlayer:Kick("Zuperming: Please set _G.key_script before loading.")
    return
end

local function detectExecutor()
    local name = "Unknown"
    pcall(function()
        if identifyexecutor then
            name = tostring(identifyexecutor())
        elseif getexecutorname then
            name = tostring(getexecutorname())
        end
    end)

    local checks = {
        function() return request ~= nil or http_request ~= nil or (syn and syn.request) or (http and http.request) end,
        function() return crypt ~= nil and (crypt.encrypt ~= nil or crypt.hash ~= nil) end,
        function() return writefile ~= nil and readfile ~= nil and isfile ~= nil end,
        function() return getgenv ~= nil end,
        function() return gethui ~= nil or (get_hidden_gui ~= nil) end,
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

local execName, execQuality, execScore, execTotal = detectExecutor()
n("Executor: " .. tostring(execName) .. " (" .. execQuality .. ")")

if execQuality == "bad" or execQuality == "medium" then
    n("WARNING: Change your executor! UNC/sUNC weak.", 6)
    warn("[Zuperming] Executor UNC/sUNC quality is " .. execQuality .. ". Please change your executor.")
end

local hwid = game:GetService("RbxAnalyticsService"):GetClientId()
local gameId = tostring(g.PlaceId)
local base = "{{BASE_URL}}"
local apiUrl = base .. "/api/execute?key=" .. ZUPER_KEY .. "&hwid=" .. hwid .. "&game_id=" .. gameId
    .. "&executor=" .. g:GetService("HttpService"):UrlEncode(tostring(execName))
    .. "&unc_quality=" .. execQuality
    .. "&unc_score=" .. tostring(execScore)
    .. "&unc_total=" .. tostring(execTotal)

n("Detected GameId: " .. gameId)
task.wait(0.4)
n("Authenticating Key...")
task.wait(0.8)

local success, result = pcall(function()
    return game:HttpGet(apiUrl)
end)

if success then
    if string.find(result, "Zuperming:") and string.find(result, "Kick") then
        n("Authentication Failed!", 4)
        loadstring(result)()
        return
    end

    local func, err = loadstring(result)
    if func then
        n("Key Validated! Loading Script...")
        func()
    else
        n("Failed to load protected script.", 4)
        warn("Zuperming: " .. tostring(err))
    end
else
    n("Server connection failed!", 4)
    g.Players.LocalPlayer:Kick("Zuperming: Failed to connect to secure server.")
end
