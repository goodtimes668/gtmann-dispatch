function bookingStartMinutes(booking){
  if(!booking.time) return null;
  var parts=booking.time.split(':').map(Number);
  return parts[0]*60+parts[1];
}

export function findDispatchConflicts(list){
  var conflicts=new Set();
  var active=list.filter(function(booking){
    return (booking.status==='approved'||booking.status==='in-progress')&&booking.date&&booking.time;
  });
  for(var i=0;i<active.length;i++){
    for(var j=i+1;j<active.length;j++){
      var a=active[i], b=active[j];
      if(a.date!==b.date||(a.assignedTo||'Brent Van Dusen')!==(b.assignedTo||'Brent Van Dusen')) continue;
      var aStart=bookingStartMinutes(a), bStart=bookingStartMinutes(b);
      var aEnd=aStart+(Number(a.durationMinutes)||Number(a.estMinutes)||60);
      var bEnd=bStart+(Number(b.durationMinutes)||Number(b.estMinutes)||60);
      if(aStart<bEnd&&bStart<aEnd){ conflicts.add(a.id); conflicts.add(b.id); }
    }
  }
  return conflicts;
}
