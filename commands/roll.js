module.exports={name:'roll',description:'Roll a bounded die: roll [sides]',aliases:['dice'],level:0,
 async execute(ctx){const raw=(ctx.args||[])[0]||'6';if(!/^\d+$/.test(raw))return ctx.tellrawCommand('Usage: roll [sides 2-1000]');const sides=Number(raw);if(sides<2||sides>1000)return ctx.tellrawCommand('Die sides must be between 2 and 1000.');ctx.tellrawCommand(`${ctx.player?.name||'Player'} rolled ${1+Math.floor(Math.random()*sides)} (d${sides}).`);}
};
