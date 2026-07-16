// Original: StarterPlayer/StarterPlayerScripts/HideVehicles (LocalScript)
// The entire original script body was commented out — preserved below.

// local playersCar = nil

// local function hasProperty(object, prop)
// 	local t = object[prop] --this is just done to check if the property existed, if it did nothing would happen, if it didn't an error will pop, the object[prop] is a different way of writing object.prop, (object.Transparency or object["Transparency"])
// end

// function hideCar(carModel)
// 	for i, child in pairs(carModel:GetDescendants()) do
// 		local success = pcall(function() hasProperty(child, "Transparency") end) --this is the part checking if the transparency existed, make sure you write the property's name correctly

// 		if success then
// 			local transparencySuccess = pcall(function() child.Transparency = 1 end) --this is the part checking if the transparency existed, make sure you write the property's name correctly
// 			if not transparencySuccess then
// 				child.Transparency = NumberSequence.new(1)
// 			end
// 			--the rest of your code
// 		end
// 	end
// end

// game.ReplicatedStorage.FunctionsAndEvents.CreateClientSidedCar.OnClientEvent:Connect(function(carModel)

// 	playersCar = carModel

// end)

// function hideExistingVehicles()
// 	for i, carModel in workspace.MenuVehicles:GetChildren() do
// 		hideCar(carModel)
// 	end
// end

// hideExistingVehicles()

// workspace.MenuVehicles.DescendantAdded:Connect(function(descendant)
// 	if descendant:IsDescendantOf(playersCar) then
// 		return
// 	end

// 	local success = pcall(function() hasProperty(descendant, "Transparency") end) --this is the part checking if the transparency existed, make sure you write the property's name correctly

// 		if success then
// 			local transparencySuccess = pcall(function() descendant.Transparency = 1 end) --this is the part checking if the transparency existed, make sure you write the property's name correctly
// 			if not transparencySuccess then
// 				descendant.Transparency = NumberSequence.new(1)
// 			end
// 			--the rest of your code
// 		end

// 	if descendant:IsA("Beam") then
// 		descendant.Enabled = false
// 	elseif descendant:IsA("ParticleEmitter") then
// 		descendant.Enabled = false
// 	end

// end)

export {};
