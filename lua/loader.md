entah ini aku bener or salah, aku juga gk tau loader lua yg kau pake sistemnya kayak apa tapi di my github make loader ini

repeat task.wait() until game.Players.LocalPlayer and game.Players.LocalPlayer.Character
if not game:IsLoaded() then game.Loaded:Wait() end

local g = game
local s = g:GetService("StarterGui")
local n = function(t,d) s:SetCore("SendNotification",{Title="ZuperMing",Text=t,Duration=d or 3}) end

local u = {
    [10200395747] = {name = "GAG2", url = "https://raw.githubusercontent.com/nynzzkeren/uiNynzz/refs/heads/main/tessstttttttttt.lua"},
    [6739698191] = {name = "VD", url = "https://raw.githubusercontent.com/nynzzkeren/uiNynzz/refs/heads/main/tessstttttttttt.lua"}
}

local d = u[g.GameId]
local m = d and d.name or "Unknown"

n("Detected: "..m)
task.wait(2)

if d then
    n("Loading "..m.."...")
    loadstring(g:HttpGet(d.url))()
else
    n("Not supported!",4)
    g.Players.LocalPlayer:Kick("Not supported!")
end