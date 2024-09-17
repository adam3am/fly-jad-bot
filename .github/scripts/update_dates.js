const fs = require('fs')
const yaml = require('js-yaml')
const axios = require('axios')
const env = require('dotenv')
const moment = require('moment-timezone')

env.config()

const VALID_DAYS = ['senin', 'selasa', 'rabu']
const MONTHS = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
]
const HOLIDAY_API_URL = process.env.HOLIDAY_API_URL

async function fetchHolidays() {
  try {
    const response = await axios.get(HOLIDAY_API_URL)
    return response.data.reduce((acc, holiday) => {
      acc[holiday.date] = holiday.name
      return acc
    }, {})
  } catch (error) {
    console.error('Failed to fetch holidays:', error)
    return {}
  }
}

function isHoliday(date, holidays) {
  return date.format('YYYY-MM-DD') in holidays
}

function getNextAvailableDate(startDate, holidays, usedDates) {
  let date = moment(startDate)
  const sixMonthsFromNow = date.clone().add(6, 'months')

  while (date.isSameOrBefore(sixMonthsFromNow)) {
    const dateString = date.format('YYYY-MM-DD')
    if (
      VALID_DAYS.includes(VALID_DAYS[date.day() - 1]) &&
      !isHoliday(date, holidays) &&
      !usedDates.has(dateString)
    ) {
      return dateString
    }
    date.add(1, 'day')
  }

  return startDate.format('YYYY-MM-DD')
}

function formatDate(dateObj) {
  return `${VALID_DAYS[dateObj.day() - 1]} ${dateObj.date()} ${MONTHS[dateObj.month()]}`
}

function updateProbeDate(probe, newDate, content) {
  const oldDateRegex = new RegExp(
    `(${probe.id}[\\s\\S]*?appointment_date: ")${probe.requests[0].body.appointment_date}`,
    'g'
  )
  return content.replace(oldDateRegex, `$1${newDate}`)
}

function updateAlertMessage(probe, correctDateText, content) {
  const probeRegex = new RegExp(
    `(${probe.id}[\\s\\S]*?message: \\|\\n\\s+\\*).*?(\\*\\s+{{#if)`,
    'g'
  )
  return content.replace(probeRegex, `$1${correctDateText}$2`)
}

async function updateDates(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  const data = yaml.load(content)
  let hasChanges = false
  const usedDates = new Set()

  // Get current date and time in UTC
  const currentDateTimeUTC = moment.utc()
  
  // Convert UTC to WIB
  const currentDateTimeWIB = currentDateTimeUTC.clone().tz('Asia/Jakarta')
  const currentHour = currentDateTimeWIB.hour()
  const currentMinutes = currentDateTimeWIB.minute()

  // Create a new date object for the starting date (in WIB)
  let startDate = currentDateTimeWIB.clone()

  // If it's past 14:35 WIB, start from tomorrow
  if (currentHour > 14 || (currentHour === 14 && currentMinutes >= 35)) {
    startDate.add(1, 'day')
  }

  // Reset time to 00:00:00 for the starting date
  startDate.startOf('day')

  // Ensure startDate is a valid day (Mon, Tue, Wed)
  while (!VALID_DAYS.includes(VALID_DAYS[startDate.day() - 1])) {
    startDate.add(1, 'day')
  }

  const sixMonthsFromNow = startDate.clone().add(6, 'months')
  const holidays = await fetchHolidays()

  console.log(`Current date and time (UTC): ${currentDateTimeUTC.format('YYYY-MM-DD HH:mm:ss')}`)
  console.log(`Current date and time (WIB): ${currentDateTimeWIB.format('YYYY-MM-DD HH:mm:ss')}`)
  console.log(`Starting date for appointments (WIB): ${startDate.format('YYYY-MM-DD')}`)

  let nextAppointmentDate = startDate.clone() // Start from the current day

  // Update all probes
  data.probes.forEach((probe) => {
    if (probe.id.startsWith('jadwal-')) {
      let newDate = getNextAvailableDate(
        nextAppointmentDate,
        holidays,
        usedDates
      )

      // Update the appointment date
      content = updateProbeDate(probe, newDate, content)
      hasChanges = true
      console.log(
        `Updated ${probe.id} from ${probe.requests[0].body.appointment_date} to ${newDate}`
      )

      usedDates.add(newDate)

      if (probe.alerts) {
        const dateObj = moment(newDate)
        const correctDateText = formatDate(dateObj)
        content = updateAlertMessage(probe, correctDateText, content)
        console.log(
          `Updated alert message for ${probe.id} to "${correctDateText}"`
        )
      }

      // Move to the next day for the next probe
      nextAppointmentDate = moment(newDate).add(1, 'day')
    }
  })

  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log('Changes made to jadwal.yml')
  } else {
    console.log('No changes needed in jadwal.yml')
  }

  return hasChanges
}

updateDates('jadwal.yml')
  .then((hasChanges) => {
    if (hasChanges) {
      console.log('Dates updated successfully')
      process.exit(0)
    } else {
      console.log('No updates were necessary')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('Error updating dates:', error)
    process.exit(1)
  })
