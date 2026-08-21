-- Zuperming Freemium Secure Loader
repeat task.wait() until game.Players.LocalPlayer and game.Players.LocalPlayer.Character
if not game:IsLoaded() then game.Loaded:Wait() end

local g = game
local s = g:GetService("StarterGui")
local n = function(t,d) pcall(function() s:SetCore("SendNotification",{Title="Zuperming Freemium",Text=t,Duration=d or 3}) end) end

local ZUPER_KEY = script_key or (getgenv and getgenv().script_key) or _G.script_key
if not ZUPER_KEY then
    n("Key not found!", 4)
    g.Players.LocalPlayer:Kick("Zuperming: Please set script_key before loading.")
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
    warn("[Zuperming Freemium] Executor UNC/sUNC quality is " .. execQuality .. ". Please change your executor.")
end

local hwid = game:GetService("RbxAnalyticsService"):GetClientId()
local placeId = tostring(g.PlaceId)
local universeId = tostring(g.GameId)
local base = "{{BASE_URL}}"
local apiUrl = base .. "/api/free/execute?key=" .. ZUPER_KEY .. "&hwid=" .. hwid .. "&game_id=" .. universeId .. "&place_id=" .. placeId
    .. "&executor=" .. g:GetService("HttpService"):UrlEncode(tostring(execName))
    .. "&unc_quality=" .. execQuality
    .. "&unc_score=" .. tostring(execScore)
    .. "&unc_total=" .. tostring(execTotal)

n("Detected GameId: " .. universeId)
task.wait(0.4)
n("Authenticating Key...")
task.wait(0.8)

local success, result = pcall(function()
    return game:HttpGet(apiUrl)
end)

if success then
    if string.find(result, "Zuperming Freemium:") and string.find(result, "Kick") then
        n("Authentication Failed!", 4)
        loadstring(result)()
        return
    end

    local func, err = loadstring(result)
    if func then
        n("Key Validated! Loading Script...")
        local ok, runtimeErr = pcall(func)
        if not ok then
            pcall(function()
                local HttpService = game:GetService("HttpService")
                local req = request or http_request or (syn and syn.request) or (http and http.request)
                if req then
                    req({
                        Url = base .. "/api/report-error",
                        Method = "POST",
                        Headers = { ["Content-Type"] = "application/json" },
                        Body = HttpService:JSONEncode({
                            error = tostring(runtimeErr),
                            executor = tostring(execName),
                            hwid = tostring(hwid),
                            game_id = tostring(universeId),
                            product = "freemium"
                        })
                    })
                end
            end)
            warn("Zuperming Freemium Runtime Error: " .. tostring(runtimeErr))
        end
    else
        n("Failed to load protected script.", 4)
        warn("Zuperming Freemium: " .. tostring(err))
    end
else
    n("Server connection failed!", 4)
    g.Players.LocalPlayer:Kick("Zuperming Freemium: Failed to connect to secure server.")
end
