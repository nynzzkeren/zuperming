-- Service Provider Secure Loader
repeat task.wait() until game.Players.LocalPlayer and game.Players.LocalPlayer.Character
if not game:IsLoaded() then game.Loaded:Wait() end

local g = game
local s = g:GetService("StarterGui")
local n = function(t,d) s:SetCore("SendNotification",{Title="Service Provider",Text=t,Duration=d or 3}) end

local ZUPER_KEY = _G.key_script
if not ZUPER_KEY then
    n("Key not found!", 4)
    g.Players.LocalPlayer:Kick("Service Provider: Please set _G.key_script before loading.")
    return
end

local hwid = game:GetService("RbxAnalyticsService"):GetClientId()
local apiUrl = "{{BASE_URL}}/api/sp/execute?key=" .. ZUPER_KEY .. "&hwid=" .. hwid

n("Authenticating Key...")
task.wait(1)

local success, result = pcall(function()
    return game:HttpGet(apiUrl)
end)

if success then
    if string.find(result, "Service Provider:") and string.find(result, "Kick") then
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
        warn("Service Provider: " .. tostring(err))
    end
else
    n("Server connection failed!", 4)
    g.Players.LocalPlayer:Kick("Service Provider: Failed to connect to secure server.")
end
