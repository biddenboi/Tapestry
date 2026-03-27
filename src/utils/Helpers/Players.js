export const getRankColorClass = (player) => {
    if (player.points < 1199) return "newbie"
    if (player.points < 1399) return "pupil"
    if (player.points < 1599) return "specialist"
    if (player.points < 1899) return "expert"
    if (player.points < 2099) return "candidate-master"
    if (player.points < 2299) return "master"
    if (player.points < 2399) return "international-master"
    if (player.points < 2599) return "grandmaster"
    if (player.points < 2999) return "international-grandmaster"
    if (player.points < 3999) return "legendary-grandmaster"
    return "legendary"
}