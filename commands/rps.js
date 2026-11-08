const games=new WeakMap();
module.exports={name:'rps',description:'Play rock-paper-scissors: rps <rock|paper|scissors>',aliases:['rpsls'],level:0,
 async execute(ctx){const move=(ctx.args||[])[0]?.toLowerCase(),say=ctx.tellrawCommand.bind(ctx),valid=['rock','paper','scissors'];if(!valid.includes(move))return say('Usage: rps <rock|paper|scissors>');const bot=ctx.bot,choices=games.get(bot)||new Set(),computer=valid[Math.floor(Math.random()*3)];choices.add(move);games.set(bot,choices);const result=move===computer?'tie':({rock:'scissors',paper:'rock',scissors:'paper'}[move]===computer?'win':'lose');say(`${ctx.player?.name||'Player'}: ${move}; bot: ${computer}. ${result.toUpperCase()}${choices.size>1?` | ${choices.size} distinct choices played this session`:''}`);}
};
